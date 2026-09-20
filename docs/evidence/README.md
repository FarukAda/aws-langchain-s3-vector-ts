# Live-AWS evidence

Each file records a behaviour the S3 Vectors service exhibits that AWS does not
document, together with the raw request and response that established it.

A behaviour recorded here becomes citable only when **both** exist: the evidence
file, and a named integration test asserting the same fact, so a live run fails
if AWS changes it. The file alone goes stale silently; the test alone cannot be
checked by a reviewer without AWS credentials.

Nothing runs that live suite on a schedule, deliberately. It runs on every `v*`
tag — `release.yml` requires its check before publishing — and on demand,
locally or by workflow dispatch (`npm run test:integration`, see the README's
*Testing* section). So every published version has had these claims re-checked
against the live service at the moment it was cut, and between releases a claim
is only as fresh as the last run. The date of each run is stated below for
exactly that reason; re-run the suite before relying on one of these claims in
a decision that matters.

## Run conditions

Every probe was issued against the raw SDK, never through this package, so
nothing in `src/` could colour the answers, with `maxAttempts: 1` so no retry
could mask a response — with one stated exception, `write-rate.md`, whose
subject is how this package's own dispatch behaves against the service's limits
and which therefore had to run through it. Each run used a bucket created for it and deleted after it.

Every run below used the same AWS account, so no difference between them is
explained by account-level quota or configuration. The account is not named
here: it identifies the maintainer's, and nothing in a probe can be re-derived
from it.

| Run | Date | Region | SDK | Bucket |
|---|---|---|---|---|
| 1 | 2026-09-14 | `us-east-1` | `@aws-sdk/client-s3vectors@3.1118.0` | `langchain-vectors-ci` |
| 2 | 2026-09-16 | `us-east-1` | `@aws-sdk/client-s3vectors@3.1133.0` | `langchain-vectors-ci` |
| 3 | 2026-09-17 | `us-east-1` | `@aws-sdk/client-s3vectors@3.1133.0` | `langchain-vectors-ci` |
| 4 | 2026-09-20 | `us-east-1` | `@aws-sdk/client-s3vectors@3.1133.0` | `langchain-vectors-ci` |

**Run 4 settled nothing new: it re-ran the whole live tier against a fresh
ephemeral bucket and every claim below still held.** 114 tests across 8 suites,
all passing, before tagging `1.0.0` — so the facts frozen into that release
are confirmed as of that date rather than inherited from runs 1–3. It is
recorded here because a claim is only as fresh as the last run that checked it,
and "still true" is the answer this table exists to give.

One test did fail on that run, and it was the test rather than the service: the
live suite still asserted that a write to an index whose distance metric differs
from the store's *succeeds*, with the mismatch surfacing on a later read. That
had been changed deliberately — the write now checks the metric against the
`GetIndex` it already makes — and the unit suite was updated with it, while this
one was not, because nothing runs it in CI. The failure is what proves the new
check works against the real service.

## Claims settled

| Claim | Run | Result | File |
|---|---|---|---|
| T3-1 | 1 | `{}` is rejected as a filter | `filter-validation.md` |
| T3-2 | 1 | `DeleteIndex` on an absent index returns 404 | `delete-absent.md` |
| T3-4 | 1 | Metadata byte counting | `metadata-limits.md` |
| T3-5 | 1 | Cosine distance is `1 − cosine_similarity` | `cosine-distance.md` |
| T3-7 | 1 | `GetVectors` omits absent keys | `get-vectors-absent-keys.md` |
| T3-8 | 1 | `DeleteVectors` accepts absent keys | `delete-absent.md` |
| T3-9 | 1 | Metadata value types are enforced | `metadata-value-types.md` |
| T3-10 | 1 | A zero vector is rejected on a cosine index | `zero-vector.md` |
| T3-11 | 1 | Unknown `$`-prefixed filter keys are rejected | `filter-validation.md` |
| T3-12 | 1 | A type-mismatched filter comparison matches nothing, without error | `filter-validation.md` |
| T3-13 | 1 | Filtering on a non-filterable key is rejected | `filter-validation.md` |
| T3-14 | 2 | A metadata array must be non-empty and hold one type | `metadata-value-types.md` |
| T3-15 | 2 | An unpaired UTF-16 surrogate fails the whole request | `string-encoding.md` |
| T3-16 | 2 | Filter operand types are enforced as documented | `filter-validation.md` |
| T3-17 | 2 | A filter condition object holds exactly one key | `filter-validation.md` |
| T3-18 | 2 | A field's operator object holds only comparison operators | `filter-validation.md` |
| T3-19 | 2 | A non-finite filter number is sent as a string | `filter-validation.md` |
| T3-20 | 3 | The 20 MiB request body limit is exact and inclusive | `request-payload-limit.md` |
| T3-21 | 3 | Metadata value rules hold under a non-filterable key too | `metadata-value-types.md` |
| T3-22 | 3 | `CreateIndex` enforces the KMS pairing in both directions | `index-encryption.md` |
| T3-23 | 3 | A lost creation race can read the winner's configuration at once | `index-create-race.md` |
| T3-24 | 3 | What the write rate does under concurrency, and what bounds it | `write-rate.md` |
| T3-25 | 3 | A flattened, dotted metadata key is filterable like any other | `filter-validation.md` |
