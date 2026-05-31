# Road to S+ — Design

**Date:** 2026-05-31
**Status:** Approved (scope confirmed)
**Builds on:** `2026-05-31-s-tier-hardening-design.md` (100% coverage + real-AWS verify scripts, already implemented on branch `s-tier-hardening`).

**Goal:** Close the gap between what the package *claims* and what is *mechanically proven*, matching the quality bar of the sibling package `aws-langgraph-dynamodb-ts`, while staying within Python `langchain-aws` parity and the repo's "no overengineering" rule.

## Research findings that shaped this scope

(Full research in conversation; key conclusions:)

1. **`PutVectors`/`DeleteVectors` are request-level all-or-nothing** (HTTP 200 empty body, no per-item error array). → **No partial-batch-failure handling** — it would be dead code.
2. **AWS SDK v3 retries 429/503/5xx by default; the Python reference relies on this** (no custom retry). → **No hand-rolled retry module**; expose/document the SDK's `maxAttempts`/`retryMode` instead.
3. **Python `AmazonS3Vectors` does not implement MMR.** → **Do not implement MMR**; document it as intentionally unsupported and assert the clear error.
4. **No official LangChain.js VectorStore conformance suite exists** (`@langchain/standard-tests` is private, chat-models-only). → Contract tests are **hand-authored against the abstract `VectorStore` interface** + `asRetriever()`.
5. **AWS batch hard caps:** Put/Delete ≤500, Get ≤100, Query topK ≤100. Service exceptions: `ValidationException`, `NotFoundException`, `AccessDeniedException`, `ServiceQuotaExceededException`, `ServiceUnavailableException`, `TooManyRequestsException`, `RequestTimeoutException`, `InternalServerException` (+ KMS). No `ConflictException` on data-plane ops.
6. **Sibling S+ bar:** dedicated coded-error module (`src/shared/errors/`), 5-layer test stratification (unit+static+types+property @100% / integration / contract+conformance / scheduled real-AWS / package-smoke), scheduled nightly real-AWS + (weekly mutation) via OIDC, tag-driven provenance publish.

## Success criteria

S+ is reached when every advertised capability is mechanically proven, errors are surfaced through one typed channel, and real-AWS behavior is checked continuously — with no dead or over-built code.

## In scope

### Tier 1 — genuine gaps

**T1.1 Typed error model** (`src/shared/errors/`, mirrors the sibling)
- `error-code.ts` — `S3VectorsErrorCode` enum: `VALIDATION`, `NOT_FOUND`, `EMBEDDINGS_MISSING`, `AWS_REQUEST_FAILED`.
- `s3-vectors-error.ts` — `S3VectorsError extends Error` carrying `code: S3VectorsErrorCode`, `context: { operation: string; vectorBucketName?: string; indexName?: string }`, and native `cause`. Symbol-brand + `isS3VectorsError()` guard (the repo bans `instanceof`).
- `wrap-error.ts` — `toError(unknown): Error`; `wrapAwsError(cause, code, context): S3VectorsError` that returns an already-`S3VectorsError` unchanged (nearest-failure wins).
- Move `isAwsNotFoundException` into this directory (`aws-not-found.ts`).
- Wire into `s3-vectors.ts`: every `this._client.send(...)` is wrapped so AWS failures surface as `S3VectorsError` with operation context; the existing validation throws (count mismatches, empty-batch) become `VALIDATION`; the missing-embeddings throw becomes `EMBEDDINGS_MISSING`; `getByIds` not-found becomes `NOT_FOUND`.
- Export `S3VectorsError`, `S3VectorsErrorCode`, `isS3VectorsError` from `src/index.ts`.
- Each file ≤150 lines, single concern.

**T1.2 VectorStore contract tests** (proves the README's "drop-in / `asRetriever()` / RAG" claim)
- `test/contract/vector-store-contract.test.ts` (mocked, via `aws-sdk-client-mock`): exercises the 4 abstract members (`_vectorstoreType`, `addVectors`, `addDocuments`, `similaritySearchVectorWithScore`), the base delegators (`similaritySearch`, `similaritySearchWithScore`), `delete`, `getByIds`, `fromTexts`/`fromDocuments`, and `asRetriever().invoke(query)` returning documents. Includes empty-store and `k > N` edge cases, and asserts score ordering.
- `test/contract/mmr.test.ts`: asserts `maxMarginalRelevanceSearch` throws a clear "not implemented / unsupported" error (parity contract).
- Live: extend the verify scripts (`verify-search.mjs`) with `asRetriever().invoke()` and the full filter-operator matrix (`$ne`, `$gt`/`$gte`/`$lt`/`$lte`, `$in`/`$nin`, `$exists`, `$and`/`$or`) against real AWS.

**T1.3 MMR + retry documentation & config**
- README + JSDoc: MMR is intentionally not implemented (parity with Python); recommend pre-filtering or client-side re-ranking.
- Add `maxAttempts?: number` and `retryMode?: 'standard' | 'adaptive' | 'legacy'` to `AmazonS3VectorsConfig`, threaded into `new S3VectorsClient(...)`. Document that throttling/5xx retry is handled by the AWS SDK. Unit-test that the options are applied.

**T1.4 Remove Stryker** (decided — not needed; removing a disabled scaffold)
- Delete `stryker.conf.json`, the `.stryker-tmp/` dir, `.stryker-incremental.json`, the `test:mutate` / `test:mutate:quick` scripts, and the `@stryker-mutator/*` devDependencies.
- Remove the "Mutation testing" section from `README.md` and any Stryker mention in `CLAUDE.md`.

### Tier 2 — polish to flawless

**T2.1 Early input validation** (`src/shared/validation.ts`)
- Validate `indexName` (3–63 chars; lowercase letters/numbers/hyphens/dots; starts and ends alphanumeric) and non-empty `vectorBucketName`, throwing `S3VectorsError` `VALIDATION` in the constructor (before any AWS call). Named constants for the bounds/pattern.

**T2.2 Property-based tests** (`test/property/`, `fast-check` devDependency)
- `metadata.property.test.ts`: for arbitrary metadata + pageContent, `buildPutMetadata` → `createDocument` round-trips content and user metadata (with a non-null key).
- `batching.property.test.ts`: for arbitrary item counts and batch sizes, the number of `Put`/`Get`/`Delete` calls equals `ceil(n / batchSize)`.

**T2.3 Package-smoke test** (`test/package-smoke/smoke.test.mjs`, Node's built-in `node --test`)
- `npm pack` the tarball, install/import it in a temp dir, construct `AmazonS3Vectors`, and assert all public exports resolve (`AmazonS3Vectors`, `S3VectorsError`, `S3VectorsErrorCode`, `isS3VectorsError`, relevance fns, types). Script `test:package-smoke`.

**T2.4 Types test** (`test/types/public-api.test-d.ts`)
- Compile-time assertions on the public config/types surface, checked by `tsc --noEmit` (no runtime). Catches accidental type-signature regressions.

**T2.5 Scheduled live-AWS CI** (respects the "no `pull_request` trigger" rule)
- Add a `schedule` (nightly cron) to the live-AWS workflow that runs `npm run test:integration` (the env-gated jest smoke — random embeddings, **no Bedrock dependency**, cheap drift detection) via the existing OIDC role, keeping `workflow_dispatch`.

**T2.6 0.3.1 release + observability docs**
- Bump to `0.3.1` with a `CHANGELOG.md` entry. (Pre-1.0, so no semver-stability promise — additive error API + features warrant the minor bump.)
- README "Observability" subsection: the library adds no logging by design; inject a pre-configured `S3VectorsClient` (with middleware/logger) via the existing `client` config option for instrumentation.

## Out of scope (research-driven — building these would be wrong)

- **Partial-batch-failure handling** — API is all-or-nothing.
- **Hand-rolled retry/backoff** — SDK default; Python parity relies on it.
- **MMR implementation** — absent from the Python reference.
- **Pagination / `ListVectors`** — not needed for the current method surface.
- **Mutation testing** — removed per decision.
- **`pull_request` CI trigger** — excluded per project preference.

## Constraints

- Binding repo coding rules (kebab-case files, JSDoc-only, ≤150 lines, no `any`/`unknown`, named constants, no `instanceof`, 100% coverage enforced).
- No `Co-Authored-By: Claude` / AI attribution anywhere.
- Multi-phase work = local commits per phase, no per-phase PRs/pushes.
- New public exports (`S3VectorsError` etc.) are additive; no breaking change to existing API beyond errors now being typed.