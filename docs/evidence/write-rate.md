# T3-24 — what the documented write rate does under concurrency, and what actually keeps a store inside it

Run conditions: run 3 in [`README.md`](./README.md). Unlike the other files
here, the measurements below were taken **through this package** rather than the
raw SDK: what is being established is how the package's own dispatch behaves
against the service's limits, which is not a question the raw SDK can answer.

AWS documents the limits and hedges the consequence: "up to one thousand
`PutVectors` or `DeleteVectors` requests per second per vector index, or … up to
two thousand five hundred vectors per second per vector index — whichever limit
is reached first. If you exceed the request rates, you might receive a `429
TooManyRequestsException`" (best practices). "Might" is doing real work in that
sentence, so it was measured.

All runs wrote 8-dimension vectors — tiny bodies, so the request rate is what
binds — from a laptop outside the region, against a fresh index.

| What ran | Rate reached | 429s | Outcome |
|---|---|---|---|
| 1 call × 20,000, batch 200 | 3,844 vectors/s | 0 | all written |
| 1 call × 20,000, batch 500 | 6,026 vectors/s | 0 | all written |
| 4 concurrent × 10,000, batch 200 | 7,960 vectors/s | 16 | all written; the SDK's retries absorbed them |
| 4 concurrent × 10,000, batch 500 | 9,702 vectors/s | 12 | all written |
| 4 concurrent × 10,000, batch 500, `retryMode: 'adaptive'` | 1,945 vectors/s | 12 | all written |
| **8 concurrent × 25,000, batch 200** | 18,078 vectors/s | 120 | **all 8 calls failed `THROTTLED`**, 63,800 of 200,000 written |

## What this establishes

- **A burst well past the documented rate is tolerated.** A single writer at
  6,026 vectors/s drew no throttling at all, so 2,500 is a sustained-rate
  limit rather than a hard ceiling per second.
- **Concurrent writers on one store are what break it.** The cap that existed,
  `maxConcurrentBatchCalls`, bounds one call's requests in flight; eight calls
  had eight times it, and the SDK's three attempts with ~500 ms throttling
  backoff cannot absorb a sustained overrun. The failure is partial by nature:
  every call reported what it had already written.

## The two obvious fixes do not work

Both were measured against that failing load, unchanged in every other respect:

| Candidate | Rate reached | 429s | Outcome |
|---|---|---|---|
| One store-wide cap of 10 requests in flight (peak confirmed 10) | 6,937 vectors/s | 159 | all 8 calls failed, 129,600 of 200,000 written |
| `retryMode: 'adaptive'`, no cap change | 774 vectors/s | 95 | all 8 calls failed, 23,400 of 200,000 written, in 4.3 minutes |

A cap on concurrency does not bound a rate: ten small batches in flight still
left ~7,000 vectors/s. Adaptive mode reacts only after throttling has begun, and
paid 9× throughput for it in the four-writer run without changing the 429 count.

## What does work

A token bucket per store, in AWS's own two units, defaulting to AWS's own
numbers — `internal/rate-limit.ts`:

| What ran | Rate reached | 429s | Outcome |
|---|---|---|---|
| 8 concurrent × 25,000, batch 200, limiter at 2,500/s and 1,000/s | 2,495 vectors/s | **0** | **200,000 of 200,000 written** |
| 1 call × 20,000, same limiter | 2,546 vectors/s | 0 | all written |

The cost is visible in that last row: a single writer that reached 3,844
vectors/s unpaced runs at 2,546 paced, because it was exceeding the documented
rate on the service's tolerance. `writeRateLimit` raises or removes the cap for
anyone who has measured their own headroom.

## Caveats a reader should carry

- 8-dimension vectors maximise the achievable request rate. A 1,024-dimension
  workload moves far fewer vectors per second, so it reaches these limits later.
- The limiter is per store instance. Separate processes writing one index can
  still exceed the limit between them, and the SDK's retries remain the backstop.
- Rates and tolerances are AWS's to change.

## Guarded by

`test/integration/write-rate.test.ts` — "the default pacing keeps a burst inside
the service's limit", which writes 3,000 vectors through the package and fails
if any call comes back `THROTTLED`.
