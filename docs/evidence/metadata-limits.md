# T3-4 — how AWS counts metadata bytes

Run conditions: run 1 in [`README.md`](./README.md).

**Claim settled.** The 2 KB filterable and 40 KB total metadata limits are
counted over the **UTF-8 byte length of the JSON serialisation** of the metadata
object — key names, quotes, colons, commas and braces included — plus a fixed
**5-byte overhead**.

## Method

Binary search for the longest accepted value, repeated with two key lengths so
that key names could be isolated, and once with a two-byte character so the
encoding could be.

Index: dimension 4, `cosine`, `nonFilterableMetadataKeys: ['bulk']`.

## Measurements

| Probe | Longest accepted value | Serialised JSON bytes | Documented limit | Gap |
|---|---|---|---|---|
| `{"f":"x"×n}` | 2035 | 2043 | 2048 | 5 |
| `{"ffffffffff":"x"×n}` | 2026 | 2043 | 2048 | 5 |
| `{"bulk":"x"×n}` (non-filterable) | 40944 | 40955 | 40960 | 5 |
| `{"f":"é"×n}` | 1017 | 2042 | 2048 | — |

Rejections, verbatim:

```
Invalid record for key 'probe': Filterable metadata must have at most 2048 bytes
  fieldList: [{ path: "vectors[0].metadata", ... }]
Invalid record for key 'probe': Metadata object must have at most 40960 bytes
```

## What each probe establishes

**Key names count.** A 1-character key accepts 2035; a 10-character key accepts
2026. The difference is exactly 9 — the difference in key length — so the count
is over the whole serialised object rather than over values alone.

**The count is UTF-8, not UTF-16 code units.** 1017 `é` characters are accepted
and 1018 are not. At two UTF-8 bytes each that is 2034 bytes of value, against
2035 single-byte characters in the ASCII probe. A UTF-16 count would have
accepted roughly 2035 of them.

**There is a 5-byte overhead.** Both limits land exactly 5 bytes below the
documented figure, measured independently at two very different scales (2048 and
40960). Whatever those 5 bytes are — per-record framing, most likely — they are
charged against the caller's budget.

**The 40 KB limit covers non-filterable metadata too.** The `bulk` key is
declared non-filterable, so it is exempt from the 2 KB rule and still bounded by
the 40 KB one.

## Key count

Exactly 50, as documented:

| Keys | Result |
|---|---|
| 49 | accepted |
| 50 | accepted |
| 51 | `Metadata object must have at most 50 keys` |

## Consequence for the contracts

Local enforcement becomes exact rather than a guess:

```
byteLength(JSON.stringify(filterableSubset)) + 5 ≤ 2048
byteLength(JSON.stringify(wholeMetadata))    + 5 ≤ 40960
Object.keys(wholeMetadata).length                 ≤ 50
```

The filterable subset is the metadata minus the keys declared non-filterable at
index creation, which this package knows — it sets them.

Erring by the 5-byte overhead is conservative in the caller's favour: a payload
this package accepts is one AWS accepts.
