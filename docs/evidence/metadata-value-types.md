# T3-9 — metadata value types are enforced

Run conditions: see [`README.md`](./README.md) in this directory.

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
