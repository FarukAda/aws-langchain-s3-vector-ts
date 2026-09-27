# T3-4, T3-26 — how AWS counts metadata bytes

Run conditions: runs 1 and 5 in [`README.md`](./README.md).

**Claim settled.** The 2 KB filterable and 40 KB total metadata limits are
counted by a size model of the service's own, **not** over the JSON text of the
metadata:

```
size   = 4 + Σ over entries (8 + UTF-8 bytes of the key + value)
value  = string  → its UTF-8 bytes, as written
         number  → 4, whatever its digits
         boolean → 0
         array   → Σ over elements (4 + the element's value)
```

Run 1 measured one key holding one string, where this model and "the JSON text
plus 5 bytes" give the same answer, and this file stated the second. Run 5
measured the shapes that tell them apart, and the JSON count was wrong in both
directions — see T3-26 below.

## T3-4 — run 1: one key, one string

Binary search for the longest accepted value, repeated with two key lengths so
that key names could be isolated, and once with a two-byte character so the
encoding could be.

Index: dimension 4, `cosine`, `nonFilterableMetadataKeys: ['bulk']`.

| Probe | Longest accepted value | Model size at that value | Documented limit |
|---|---|---|---|
| `{"f":"x"×n}` | 2035 | 4 + 8 + 1 + 2035 = 2048 | 2048 |
| `{"ffffffffff":"x"×n}` | 2026 | 4 + 8 + 10 + 2026 = 2048 | 2048 |
| `{"bulk":"x"×n}` (non-filterable) | 40944 | 4 + 8 + 4 + 40944 = 40960 | 40960 |
| `{"f":"é"×n}` | 1017 | 4 + 8 + 1 + 2034 = 2047 (1018 would be 2049) | 2048 |

Rejections, verbatim:

```
Invalid record for key 'probe': Filterable metadata must have at most 2048 bytes
  fieldList: [{ path: "vectors[0].metadata", ... }]
Invalid record for key 'probe': Metadata object must have at most 40960 bytes
```

What these establish on their own: key names count, byte for byte (a
10-character key accepts exactly 9 fewer bytes of value than a 1-character one);
the count is UTF-8, not UTF-16 code units (1017 `é` fit, 1018 do not); and the
40 KB limit covers non-filterable metadata too.

## T3-26 — run 5: the shapes that tell the models apart

Index: dimension 4, `cosine`, `nonFilterableMetadataKeys: ['nf']`. Each shape
was binary-searched for the largest `n` the service accepts. "JSON rule" is the
largest `n` for which `byteLength(JSON.stringify(subset)) + 5 ≤ limit`, the rule
this package applied until then.

First round — fifteen shapes, from which the model was fitted:

| Shape (`f` = `"x"×n` unless stated) | AWS max `n` | JSON rule | Model |
|---|---|---|---|
| `{f}` (control) | 2035 | 2035 | 2035 |
| `f` + 19 keys `k00`…`k18` = `"y"` | 1807 | 1845 (**too loose**) | 1807 |
| `f` + 10 keys `n0`…`n9` = `0.1234567890123456` | 1895 | 1795 (too strict) | 1895 |
| `f` + 10 keys `e0`…`e9` = `1e21` | 1895 | 1925 (**too loose**) | 1895 |
| `f` + 10 keys `i0`…`i9` = `7` | 1895 | 1965 (**too loose**) | 1895 |
| `f` + 10 keys `b0`…`b9` = `true` | 1935 | 1935 | 1935 |
| `f` + `a` = 50 × `1.5` | 1626 | 1829 (**too loose**) | 1626 |
| `f` + `s` = 50 × `"ab"` | 1726 | 1779 (**too loose**) | 1726 |
| `{f: "\n"×n}` | 2035 | 1017 (too strict) | 2035 |
| `{f: '"'×n}` | 2035 | 1017 (too strict) | 2035 |
| `{f: "\\"×n}` | 2035 | 1017 (too strict) | 2035 |
| `{f: "\u0001"×n}` | 2035 | 339 (too strict) | 2035 |
| `{f: "中"×n}` | 678 | 678 | 678 |
| total: `nf` = `"x"×n` + 30 keys `k00`… = `"v"` | 40586 | 40646 (**too loose**) | 40586 |
| total: `{nf: "\n"×n}` | 40946 | 20473 (too strict) | 40946 |

Second round — nine shapes the model had not seen, its limit computed before
each was sent. Every one landed exactly:

| Shape | AWS max `n` | Model |
|---|---|---|
| `f` + 40 booleans `b00`… | 1595 | 1595 |
| `{"中中中": "x"×n, "日本": "v"}` | 2012 | 2012 |
| `f` + 5 arrays of 10 numbers (`j × 1e300`) | 1585 | 1585 |
| `f` + 20 × `"中中"` in one array | 1826 | 1826 |
| `f` + `-0.5`, `1e-300`, `-123456789` | 1996 | 1996 |
| `f` + 48 keys `key00`… = `"ab"` | 1315 | 1315 |
| `f` + two `""`, `[1]`, `["z"]` | 1986 | 1986 |
| total: `nf` bulk + 20 numbers + 30-number array | 40405 | 40405 |
| total: `{nf: "中"×n}` | 13648 | 13648 |

Every rejection read `Filterable metadata must have at most 2048 bytes` or
`Metadata object must have at most 40960 bytes`, as in run 1.

**"Too loose" is the failure that matters.** A write the JSON rule accepted and
AWS refused reached the service only after its batch had been embedded and
earlier batches had landed — the outcome this package's local check exists to
prevent. Many short keys and numeric arrays cost more than their JSON text,
because each entry and each array element carries a fixed charge; escaped text
costs less, because the service counts the characters, not their escapes.

## Key count

Exactly 50, as documented:

| Keys | Result |
|---|---|
| 49 | accepted |
| 50 | accepted |
| 51 | `Metadata object must have at most 50 keys` |

## Consequence for the contracts

Local enforcement applies the model, over the filterable subset for 2048 and the
whole object for 40960, with at most 50 keys. The filterable subset is the
metadata minus the keys declared non-filterable at index creation, which this
package knows — it sets them. `test/integration/evidence-guards-run5.test.ts`
re-checks five of the boundaries above against the live service.

This is the **storage** size. The size a record adds to a `PutVectors` request
body — which the 20 MiB limit is about (`request-payload-limit.md`) — is its
JSON, escapes included, and the write path budgets requests with that instead.
