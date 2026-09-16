# Live-AWS evidence

Each file records a behaviour the S3 Vectors service exhibits that AWS does not
document, together with the raw request and response that established it.

A behaviour recorded here becomes citable only when **both** exist: the evidence
file, and a named integration test asserting the same fact, so a live run fails
if AWS changes it. The file alone goes stale silently; the test alone cannot be
checked by a reviewer without AWS credentials.

Nothing runs that live suite on a schedule. It is a local, on-demand tier
(`npm run test:integration`, see the README's *Testing* section), so a claim
here is only as fresh as the last time someone ran it — the date of each run is
stated below for exactly this reason. Re-run the suite before relying on one of
these claims in a decision that matters.

## Run conditions

Every probe was issued against the raw SDK, never through this package, so
nothing in `src/` could colour the answers, with `maxAttempts: 1` so no retry
could mask a response. Each run used a bucket created for it and deleted after it.

| Run | Date | Region | Account | SDK | Bucket |
|---|---|---|---|---|---|
| 1 | 2026-09-14 | `us-east-1` | 712098997573 | `@aws-sdk/client-s3vectors@3.1118.0` | `langchain-vectors-ci` |
| 2 | 2026-09-16 | `us-east-1` | 712098997573 | `@aws-sdk/client-s3vectors@3.1133.0` | `langchain-vectors-ci` |

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
