# T3-1 and T3-11 — filter validation

Run conditions: see [`README.md`](./README.md) in this directory. Index: dimension 4, `cosine`, one stored vector
with metadata `{ g: 'a' }`.

Every rejection below is `ValidationException`, HTTP 400, with an identical body:

```
message:   "Invalid filter"
fieldList: [{ path: "filter", message: "Invalid filter" }]
```

| Filter | Result |
|---|---|
| `{}` | **rejected** — T3-1 confirmed |
| `{ g: { $eg: 'a' } }` (typo for `$eq`) | **rejected** — T3-11 confirmed |
| `{ g: { $schema: 'https://example.com' } }` | **rejected** |
| `{ g: { $in: [] } }` | **rejected** — the documented non-empty rule confirmed |

## What this establishes

**T3-1.** `{}` is not "no filter"; it is invalid. The package's existing
rejection is correct, and it matters because a filter assembled dynamically —
conditions added only when a UI field is set — becomes `{}` on its own whenever
nothing applies.

**T3-11, and it removes the objection to local vocabulary checking.** The concern
was that a `$`-prefixed key might be a legitimate literal rather than a mistyped
operator, making local rejection a false rejection. `{ g: { $schema: … } }`
settles it: AWS rejects that too. There is no legitimate `$`-prefixed literal in
a filter position, so this package can reject an unknown operator locally without
ever refusing something the service would have accepted.

**Local checking is worth more than usual here**, because the service's own
diagnosis is the bare string "Invalid filter" — no indication of which operator,
which field, or what was wrong with it. A local check can name all three.

## T3-12 and T3-13 — what the service accepts but does not match

Not every filter the service accepts is a filter that can match. Two cases the
README describes were re-confirmed on 2026-09-15 against an index holding one
vector with metadata `{ popular: true, genre: 'scifi' }` and `_page_content`
declared non-filterable:

| Filter | Result |
|---|---|
| `{ popular: { $eq: true } }` | 1 result — the control |
| `{ popular: { $eq: 'true' } }` | **0 results, no error** — T3-12 |
| `{ nope: { $eq: 'x' } }` (absent field) | 0 results, no error |
| `{ _page_content: { $eq: 'alpha' } }` | **rejected** — `ValidationException`, "Invalid use of non-filterable metadata in filter" — T3-13 |

**T3-12.** A type-mismatched comparison is indistinguishable from a field that
does not exist: both return nothing and neither is an error. A boolean stored as
`true` and compared against the string `'true'` — the shape a query string or a
form value arrives in — silently matches nothing. This package cannot detect it:
the metadata type is the writer's, the filter value is the reader's, and nothing
in a single call sees both. It is documented instead.

**T3-13.** Filtering on a non-filterable key is refused by the service rather
than ignored, and unlike the bare "Invalid filter" above, this message says what
is wrong. It is easy to reach by accident: the key excluded for index-size
reasons is often the interesting one to filter by.
