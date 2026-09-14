# T3-7 — `GetVectors` omits keys that do not exist

Run conditions: see `README.md`. Stored keys: `same`, `orth`.

```
GetVectors  keys: ['same', 'does-not-exist', 'orth'], returnMetadata: true
→ HTTP 200
   vectors: [ { key: 'orth', metadata: { g: 'a' } },
              { key: 'same', metadata: { g: 'a' } } ]

GetVectors  keys: ['nope-1', 'nope-2']
→ HTTP 200
   vectors: []
```

## What this establishes

**Absent keys are omitted, not an error.** A request mixing present and absent
keys succeeds carrying only the present ones, and a request for nothing but
absent keys returns an empty array with a 200. That is what makes `getByIds`'
`(Document | undefined)[]` shape possible: absence is an ordinary outcome the
service reports by omission.

**The response does not preserve request order.** `['same', 'does-not-exist',
'orth']` came back as `['orth', 'same']` — reordered, not merely compacted. Any
caller aligning results to requested ids by position would mis-pair them. The
package's map-then-reorder approach is therefore necessary rather than
defensive, and this is the evidence for it.
