# T3-1, T3-11 to T3-13 and T3-16 to T3-19 — filter validation

Run conditions: run 1 in [`README.md`](./README.md). Index: dimension 4, `cosine`, one stored vector
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

## T3-16 — operand types are enforced as documented

Run conditions: run 2 in [`README.md`](./README.md). Index: dimension 4, `cosine`,
vectors carrying `{ s: 'a', n: 1, b: true, arr: ['x', 'y'], narr: [1, 2] }`.

The user guide gives each operator's *valid input types*
(`s3-vectors-metadata-filtering.html`). The service enforces them: every
rejection below is `ValidationException`, HTTP 400, "Invalid filter".

| Operator | Accepted | Rejected |
|---|---|---|
| `$eq`, `$ne` | a string, a number, a boolean | `null`, `['a']`, `[]`, `{}` |
| `$gt`, `$gte`, `$lt`, `$lte` | a number, fractional included | `'1'`, `true`, `null`, `[1]`, `{}`, `NaN`, `Infinity` |
| `$in`, `$nin` | a non-empty array of strings, numbers and booleans — **mixed types allowed** | `[null]`, `[{}]`, `[['a']]`, `'a'`, `[]` |
| `$exists` | `true`, `false` | `'yes'`, `'true'`, `1`, `null` |
| shorthand `{ field: v }` | a string, a number, a boolean | `null`, `['a']`, `[]` |

"Non-empty array of primitives" in the guide does not include `null`, although
`null` is a JavaScript primitive.

## T3-17 — a condition object holds exactly one key

Run conditions: run 2.

| Filter | Result |
|---|---|
| `{ s: 'a', b: true }` | **rejected** |
| `{ s: { $eq: 'a' }, n: { $eq: 1 } }` | **rejected** |
| `{ $and: [{ s: 'a', n: 1 }] }` | **rejected** — the rule holds inside a branch too |
| `{ $and: [{ s: 'a' }], s: 'a' }` | **rejected** |
| `{ $and: [{ s: 'a' }], $or: [{ n: 1 }] }` | **rejected** |
| `{ $and: [{ s: 'a' }, { n: 1 }] }` | accepted — the same conditions, combined |
| `{ $or: [{ $and: [{ s: 'a' }, { n: 1 }] }] }` | accepted |
| `{ s: { $eq: 'a', $ne: 'b' } }`, `{ n: { $gte: 0, $lte: 5 } }` | accepted — several *operators* on one field are fine |
| `{ '': 'x' }` | accepted — an empty field name is not a problem |

A filter assembled from several optional form fields as `{ genre, year }` is
exactly this shape, and the service answers it with the same bare "Invalid
filter" as any other mistake.

## T3-18 — a field's operator object holds only comparison operators

Run conditions: run 2. Every row is `ValidationException`, "Invalid filter".

| Filter | Result |
|---|---|
| `{ s: {} }` | **rejected** |
| `{ s: { x: 1 } }` | **rejected** |
| `{ s: { $eq: 'a', x: 1 } }` | **rejected** |
| `{ s: { $and: [{ s: 'a' }] } }`, `{ s: { $or: [{ s: 'a' }] } }` | **rejected** |
| `{ $and: [{}] }`, `{ $and: ['x'] }` | **rejected** |

## T3-19 — a non-finite filter number is sent as a string

Run conditions: run 2.

| Filter | Result |
|---|---|
| `{ n: NaN }`, `{ n: { $eq: NaN } }`, `{ n: { $in: [NaN] } }` | **accepted, and matched nothing** |
| `{ n: { $gt: NaN } }`, `{ n: { $gt: Infinity } }` | rejected, like a string operand |

The AWS SDK's JSON serialiser writes a non-finite number as a quoted string
(`@aws-sdk/core@3.978.0` `dist-cjs/submodules/protocols/index.js:1096`), and a
`Date` inside a document as a timestamp (`:1065`). The service therefore saw
`"NaN"`: a string, which `$eq` and `$in` accept and a range operator refuses. A
caller's `NaN` became a filter that silently matches nothing. This is the reason
this package refuses a non-finite number and a `Date` in a filter, as it already
does in metadata: what would be sent is not what was written.

## T3-25 — a flattened, dotted key is filterable like any other

Run conditions: run 3 in [`README.md`](./README.md).

`flattenMetadata` turns `loc: { pageNumber: 2 }` into `"loc.pageNumber": 2`, and
that is only worth doing if the result can still be searched. Two vectors were
written with flattened metadata and queried through every operator shape the
documentation offers for a scalar:

```
stored  p2 { source: 'a.pdf', 'loc.pageNumber': 2, 'pdf.info.Title': 'report' }
        p7 { source: 'a.pdf', 'loc.pageNumber': 7, 'pdf.info.Title': 'appendix' }

filter { 'loc.pageNumber': 2 }                       → ['p2']
filter { 'loc.pageNumber': { $eq: 2 } }              → ['p2']
filter { 'loc.pageNumber': { $gte: 5 } }             → ['p7']
filter { 'loc.pageNumber': { $exists: true } }       → ['p2', 'p7']
filter { 'pdf.info.Title': { $eq: 'report' } }       → ['p2']
filter { source: 'a.pdf' }            (control)      → ['p2', 'p7']
```

### What this establishes

A dot in a metadata key is an ordinary character to the filter language: it
selects no nested path, and it prevents nothing. So flattening loses no query —
`loc.pageNumber` is as filterable as `source`, including through a range and an
existence check, and a key flattened from two levels down (`pdf.info.Title`)
behaves the same.

That is what licenses the README's ingestion advice. Without it, flattening
would have traded a refused write for a document nobody can find.

### Guarded by

`test/integration/evidence-guards-run3.test.ts` — "matches a dotted key by
equality, by range and by existence".
