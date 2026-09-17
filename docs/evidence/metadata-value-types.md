# T3-9 — metadata value types are enforced

Run conditions: run 1 in [`README.md`](./README.md).

```
PutVectors  metadata: { obj: { a: 1 } }
→ ValidationException, HTTP 400
   "Invalid record for key 'nested': Metadata values must be strings, numbers, booleans, or arrays"
   fieldList: [{ path: "vectors[0].metadata", ... }]

PutVectors  metadata: { arr: [{ a: 1 }] }
→ ValidationException, HTTP 400
   "Invalid record for key 'nested2': Metadata array values must be strings or numbers"
```

## What this establishes

The service enforces the value types the user guide lists, and the enforcement is
**stricter than the documentation states**:

- A nested object is rejected outright.
- An array may contain **only strings or numbers** — not booleans, and not
  objects. The user guide says metadata supports "string, number, boolean, and
  list types" without saying what a list may hold.

## This reverses an earlier decision

This package used to pass nested objects through, on the reasoning that an
omission from a documented list is not evidence of rejection and that a false
local rejection would be worse than a round trip.

The reasoning was right and its premise is now disproved. These **are** rejected,
so local validation refuses nothing the service would have accepted — and it
saves the round trip plus the embedding spend that preceded it. `buildPutMetadata`
validates value types.

## T3-14 — an array must be non-empty and hold one type

Run conditions: run 2 in [`README.md`](./README.md).

```
PutVectors  metadata: { arr: [] }
→ ValidationException, HTTP 400
   "Invalid record for key 'm-4': Empty arrays are not allowed in metadata"

PutVectors  metadata: { arr: [1, 'a'] }
→ ValidationException, HTTP 400
   "Invalid record for key 'm-5': Metadata array values must be strings or numbers"

PutVectors  metadata: { arr: ['a', 1] }
→ ValidationException, HTTP 400
   "Invalid record for key 'm-6': Metadata array values must be strings or numbers"
```

Accepted in the same run, as controls: `['a', 'b']`, `[1, 2.5]`, `['']`,
`['dup', 'dup']`, and the scalar values `''`, `0` and `-1.5`.

Also accepted, and recorded because they settle what this package does **not**
need to check: a metadata key that is empty (`''`), 63, 64 or 1,024 characters
long, starts with `$` (`'$eq'`), or contains a dot (`'a.b'`).

### What this establishes

- An empty array is refused outright. It is the shape an empty tag list takes,
  so it is a common one.
- An array holding strings *and* numbers is refused, with the same message the
  service gives a boolean or object element. The rule is per array, not per
  element: each element being acceptable on its own is not enough.
- An empty string and a repeated element are both fine, and nothing about a key
  is enforced beyond the documented count and its encoding (`string-encoding.md`).

`buildPutMetadata` refuses both shapes locally, before the embedding call and the
round trip that would otherwise precede the rejection.

## T3-21 — the value rules hold under a **non-filterable** key too

Run conditions: run 3 in [`README.md`](./README.md).

The user guide describes non-filterable metadata as the place for "larger
amounts of contextual data", which invites the reading that it is also the place
for richer *types*. It is not. On an index created with
`nonFilterableMetadataKeys: ['_page_content', 'blob']`, every shape refused
under a filterable key is refused under `blob` as well:

```
PutVectors  metadata: { obj: { a: 1 } }                     (filterable control)
→ ValidationException, HTTP 400  "Metadata values must be strings, numbers, booleans, or arrays"
                                 requestId 14f23943-8568-8a5f-a49e-c07f59da03b2

PutVectors  metadata: { blob: { a: 1 } }
→ ValidationException, HTTP 400  same message   requestId 19d3b461-35a8-895f-9693-e7c8a4abc99f

PutVectors  metadata: { blob: { lines: { from: 1, to: 10 } } }        (text-splitter shape)
→ ValidationException, HTTP 400  same message   requestId 1606028c-759d-878f-8d9c-f60050b96656

PutVectors  metadata: { blob: { version: '1.10.100', info: { Title: 't' },
                                metadata: null, totalPages: 3 } }     (PDF-loader shape)
→ ValidationException, HTTP 400  same message   requestId 1ec5f0f4-ba86-8906-80bc-8249bff04127

PutVectors  metadata: { blob: null }
→ ValidationException, HTTP 400  same message   requestId 18d5a5bd-8fb8-84d7-a49c-e3b1cae375c2

PutVectors  metadata: { blob: [true, false] }
→ ValidationException, HTTP 400  "Metadata array values must be strings or numbers"
PutVectors  metadata: { blob: [{ a: 1 }] }            → the same
PutVectors  metadata: { blob: [1, 'a'] }              → the same
PutVectors  metadata: { blob: [] }
→ ValidationException, HTTP 400  "Empty arrays are not allowed in metadata"

PutVectors  metadata: { blob: 'ok' }                  (control)
→ HTTP 200; GetVectors returns { blob: 'ok' } unchanged
```

### What this establishes

Non-filterable buys **size, not types**. So the local refusal applies to every
key, filterable or not, and nothing can be loosened for the documents
`@langchain/textsplitters` and the `@langchain/community` PDF loaders produce —
their `loc` and `pdf` objects are exactly the refused shapes. `flattenMetadata`
exists for that reason, and its dotted output is what the same index accepts:

```
PutVectors  metadata: { source: 'a.txt', 'loc.lines.from': 1, 'loc.lines.to': 10 }
→ HTTP 200; read back unchanged                 requestId 1d321215-53da-8750-a96d-3d7cc187e4d1
```

### Guarded by

`test/integration/evidence-guards.test.ts` — "refuses a nested object under a
non-filterable key, and stores its flattened form".
