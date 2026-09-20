# 6. Pace writes against the documented per-index limits

## Status

Accepted.

## Context

S3 Vectors bounds a vector index in two units at once: requests per second and
vectors per second. Nothing about a caller's code says which bound it will
reach first — a few large batches reach the vector bound, many small ones
reach the request bound.

The package already had a concurrency cap, but that bounds one call's requests
in flight, not the store's rate. Eight concurrent writes on one store
therefore ran at eight times the cap. Measured against the live service, eight
concurrent writes of 25,000 vectors ran at roughly 18,000 vectors a second,
drew 120 throttling exceptions and failed every call, with under a third of
the vectors written.

Leaving this to the caller means every caller has to discover the same thing.
Leaving it to the SDK's retries means paying for the failed requests and
accepting that a batch which exceeds capacity is not something backoff fixes.

## Decision

We pace every store's writes and deletes against one shared budget in both
units, defaulting to the limits AWS documents. `writeRateLimit` tunes it, and
`false` turns it off for callers who pace elsewhere.

## Consequences

Positive. The same load that previously failed every call now completes with
no failures and no throttling. Deletes and writes share the budget, because
the service counts them together.

Negative. A store is slower than the service would sometimes allow, since the
default is the documented limit rather than the observed one. The budget is
per store instance, so two stores against one index can still exceed it
together.

Neutral. The pacing is invisible to call sites: no action knows there is a
budget.
