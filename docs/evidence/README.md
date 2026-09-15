# Live-AWS evidence

Each file records a behaviour the S3 Vectors service exhibits that AWS does not
document, together with the raw request and response that established it.

A behaviour recorded here becomes citable only when **both** exist: the evidence
file, and a named integration test asserting the same fact, so a live run fails
if AWS changes it. The file alone goes stale silently; the test alone cannot be
checked by a reviewer without AWS credentials.

Nothing runs that live suite on a schedule. It is a local, on-demand tier
(`npm run test:integration`, see the README's *Testing* section), so a claim
here is only as fresh as the last time someone ran it — the date in the table
below is that date, and it is stated for exactly this reason. Re-run the suite
before relying on one of these claims in a decision that matters.

## Run conditions common to every file in this directory

| | |
|---|---|
| Date | 2026-09-14 |
| Region | `us-east-1` |
| Account | 712098997573 |
| SDK | `@aws-sdk/client-s3vectors@3.1118.0` |
| Client | `maxAttempts: 1`, so no retry could mask a response |
| Bucket | `langchain-vectors-ci`, created for the run and deleted after it |
| Method | Probes issued against the raw SDK, never through this package, so nothing in `src/` could colour the answers |

## Claims settled

| Claim | Result | File |
|---|---|---|
| T3-1 | `{}` is rejected as a filter | `filter-validation.md` |
| T3-2 | `DeleteIndex` on an absent index returns 404 | `delete-absent.md` |
| T3-4 | Metadata byte counting | `metadata-limits.md` |
| T3-5 | Cosine distance is `1 − cosine_similarity` | `cosine-distance.md` |
| T3-7 | `GetVectors` omits absent keys | `get-vectors-absent-keys.md` |
| T3-8 | `DeleteVectors` accepts absent keys | `delete-absent.md` |
| T3-9 | Metadata value types are enforced | `metadata-value-types.md` |
| T3-10 | A zero vector is rejected on a cosine index | `zero-vector.md` |
| T3-11 | Unknown `$`-prefixed filter keys are rejected | `filter-validation.md` |
