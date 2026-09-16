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
