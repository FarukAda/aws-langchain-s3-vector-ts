# T3-8 and T3-2 — deleting things that are not there

Run conditions: run 1 in [`README.md`](./README.md).

## T3-8 — `DeleteVectors` accepts absent keys

```
DeleteVectors  keys: ['never-existed-1', 'never-existed-2']
→ HTTP 200, empty body
```

Deleting keys that were never stored succeeds. The package's documented
idempotency for `delete({ ids })` — "a blind retry of the full `ids` list is
always safe" (`README.md`, *Errors*) — rests on this, and now has a citation rather
than an assumption.

The practical consequence is retry after an ambiguous network failure: a delete
whose response was lost can be reissued in full, without the caller first working
out which keys survived.

## T3-2 — `DeleteIndex` on an index that is already gone

```
DeleteIndex  indexName: 't3-probe-absent'   (never created)
→ NotFoundException, HTTP 404
   "The specified index could not be found"
```

Deleting an absent index is a **404, not a success**. The package swallows
`NotFoundException` on this path and resolves, which is the right behaviour — the
requested state already holds — but it is a decision this package makes, not one
the service makes for it.

That distinction is what `deleteIndex`'s contract needs. It states "if AWS
reports the index as absent, that is treated as success", and this file licenses
the clause. Without it the contract would assert an AWS behaviour nobody had
checked.

**What this probe did not cover: a missing bucket.** The probe ran against a
bucket that existed. The API reference gives `DeleteIndex` a single 404 —
`NotFoundException`, "the specified resource can't be found" — and the exception
carries nothing that says *which* resource, so resolving on it also resolved for
a store pointed at a bucket that was never there. Since `1.0.0` a 404 from
`DeleteIndex` is followed by `GetVectorBucket`, and a bucket that does not exist
is `NOT_FOUND` rather than a success. That `DeleteIndex` answers a missing bucket
with this same exception is the API reference's statement and has **not** been
probed here: the CI role's policy is scoped to one bucket, so a request naming
any other would be expected to meet IAM rather than the question of whether the
bucket exists. If the service answers a missing bucket some other way, that answer
surfaces as its own class and the question is never asked.

**Note the asymmetry**: absent *vectors* are a 200, absent *indexes* are a 404.
The two idempotency guarantees this package offers are therefore built
differently — one is the service's, one is ours.
