# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-08-29

Remediation of an independent code review run against the v0.8.0 tag. That review closed every prior finding and reported none of its own still open, so this release comes from a fresh full read of the source plus direct verification of the assumptions the previous round left standing. Two of the five findings were reproduced with a probe before being fixed; one of them was pinned as *intended* behaviour by the existing test suite.

### Breaking

- `similaritySearch` and `similaritySearchWithScore` now throw a coded `VALIDATION` error when an `AbortSignal` is passed as the 4th argument. That position is the `Callbacks` slot, and a signal there was silently discarded: the search ran to completion, uncancelled, after already spending a billable `embedQuery` call. Pass the signal as the 5th argument. `similaritySearchWithRelevanceScores` is unchanged — it historically accepted the signal in that slot, so honouring it there remains a documented back-compat affordance.
- The `QueryVectors` page guard no longer stops at a flat 100 pages. `QUERY_PAGE_LIMIT_EXCEEDED` now fires on lack of *progress* (10 consecutive result-less pages) or a 1,000-page runaway ceiling, and its message names which one fired. Searches that previously failed at page 100 while still making progress now succeed.

### Fixed

- **`addDocuments` kept embedding after the abort signal fired.** The signal was checked once per concurrent group rather than once per batch, so a signal firing partway through a group still let every remaining batch in it spend a full, uncancellable, billable embedding call — up to 9 extra calls, or roughly 1,800 documents at the default `batchSize` of 200. Reproduced before the fix: aborting during the second embed call still produced 11 `embedDocuments` calls instead of 2. An abort mid-group now also reports `context.writtenIds`, like every other partial failure.
- **The page guard failed legitimate searches.** `MAX_QUERY_PAGES` was exactly `MAX_TOP_K / 100`, resting on the belief that AWS always fills a page to 100 results. AWS documents the limit as "Results per page in a QueryVectors response: **up to** 100" — a maximum, not a guarantee — so a shorter page is a conforming response and the cap had zero headroom: one 99-result page anywhere in a `k = 10,000` search pushed it to 101 pages and rejected a valid query. The suite pinned this as intended behaviour (one result per page with `k = 500` asserted failure at page 100, though that search converges at page 500).
- **A nullish AWS response surfaced as a raw `TypeError`.** `_send` wraps only the AWS call, so the property reads on a resolved response sit outside its `catch`. `QueryVectors` and `GetVectors` responses are now checked for being an object at all before any field is read, throwing `AWS_INVALID_RESPONSE` — the same guarantee the existing field-level guards already gave, for the same non-conforming-client population.

### Added

- A `QueryVectors` failure on a continuation page now explains itself: it names the page it was on and how many results it had collected, and points at re-issuing the original query. AWS documents pagination tokens as valid for only "several minutes" and publishes no dedicated expired-token exception, so this is keyed on what the library knows for certain — that the failing call carried a `nextToken` — rather than on a guessed exception name. A first-page failure and a caller-driven abort pass through unchanged.

### Repository hygiene

- **The nightly live-AWS CI job could report success having run zero tests.** A skipped Jest suite exits 0, so "the env was never set" and "every live test passed" were indistinguishable from the job's exit code — a dropped env line or an unset secret would have turned the live run green without a single AWS call. `RUN_LIVE_INTEGRATION=1` with a missing `AWS_VECTOR_BUCKET` is now fatal rather than a silent skip (an unset `RUN_LIVE_INTEGRATION` still opts out cleanly), and the workflow additionally fails if the run reports zero passing tests.
- **The shared example harness asserted on the wrong property.** `expectThrow` compared `error.name` against an error *code*; since every error here has `name === 'S3VectorsError'`, that could never match and silently degraded to a substring match on the message, which passes whenever the text merely happens to contain the string. Replaced with `expectErrorCode`, which asserts on `error.code`, and the duplicate local copy in `verify-edge-cases.mjs` now uses it too.

### Notes

- Every AWS limit the library encodes was re-verified against AWS's published limits page rather than carried forward: `topK` ≤ 10,000, PutVectors/DeleteVectors ≤ 500, GetVectors ≤ 100, non-filterable metadata keys ≤ 10, filterable metadata ≤ 2 KB, dimension ≤ 4,096. All matched.
- The prior review's two open uncertainties (IM1, IM4) needed no new regression tests: both are already exercised by the mocked unit suite, which runs at 100% branch coverage. What neither has is a *live* trigger, and the review itself established that none can exist.

## [0.8.0] - 2026-08-29

Remediation of an independent code review run against the v0.7.0 tag, plus three defects found while verifying that review's own claims. Every finding below was reproduced before being fixed.

### Breaking

- A `config.client` that is not an `S3VectorsClient` now throws a coded `VALIDATION` error instead of emitting a `console.warn` and silently building a replacement. The replacement was constructed from the ambient credential chain and default region, so a caller who passed an explicit but wrong client could silently read and write against a different AWS account. `client: null`/`undefined` is unaffected — it is read as "not provided", the same way a `null` filter is already read as "no filter".
- A malformed or absent `distanceMetric` in a `QueryVectors` response now reports `AWS_INVALID_RESPONSE` rather than `INDEX_CONFIG_MISMATCH`. The two conditions were conflated under one code; a *valid* metric that disagrees with this store's configuration still reports `INDEX_CONFIG_MISMATCH`.
- A search that hits the 100-page `QueryVectors` limit with more pages available and fewer than `k` results collected now throws the new `QUERY_PAGE_LIMIT_EXCEEDED` instead of silently returning a short result set.

### Added

- `S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED`, with `context.pagesScanned` and `context.resultsCollected`, so a truncated search is distinguishable from one that legitimately exhausted its matches.
- `similaritySearchWithRelevanceScores` now accepts an `AbortSignal` in its fifth parameter, matching `similaritySearch` and `similaritySearchWithScore`. The fourth parameter accepts `Callbacks | AbortSignal` so the historical call style keeps working.
- A regression test asserting that `S3VectorsErrorContext.instance` never serializes client internals, and an explicit `lc_serializable = false` on `AmazonS3Vectors` so that guarantee no longer rests on an unpinned `@langchain/core` default.
- A README table documenting every `S3VectorsErrorCode` and when it is raised.

### Fixed

**Silent data corruption:**

- `addVectors`/`addDocuments`/`addTexts` never checked that a caller-supplied `options.ids` was actually an array. A string of matching length — `'abc'` alongside three vectors — passed the count check and was then sliced and indexed exactly like an array, silently writing each *character* as a vector key to AWS and returning the string itself as the caller's id list. No error was raised anywhere: wrong ids committed durably, with the usual `writtenIds` recovery path useless because the caller believed they had supplied their own ids. The `_validateIsArray` guards added in 0.6.0 covered six argument positions but missed this one in all three write methods. Not identified by the review; found while verifying it.

**Error-contract fixes:**

- The constructor threw a raw, uncoded `TypeError` for `client: null` — `null !== undefined` is `true`, so evaluation reached `null.config` before the intended fallback path could run — breaking the guarantee that every failure surfaces as a typed `S3VectorsError`.
- `similaritySearchVectorWithScore`'s missing-`distance` guard (added in 0.7.0) tested `=== undefined` only. An explicit `null` passed it and reached the relevance-score conversion, where `1.0 - null` coerces to `1.0` — the *best possible* score, and precisely the silent misranking 0.7.0 set out to close, reached through a different value. Now checked with `typeof` plus `Number.isFinite`, which also rejects `NaN` and `±Infinity`.
- `_getIndex`'s response-shape guard had the same `=== undefined` gap: a literal `null` index reached `index.dimension` and threw a `TypeError` that was caught and wrapped, but as `AWS_REQUEST_FAILED` carrying raw internal text (`Cannot read properties of null`) rather than the `AWS_INVALID_RESPONSE` diagnosis the same function already produces for every other malformed shape.
- `delete({ deleteAll: true })` against an already-deleted index surfaced a generic `AWS_REQUEST_FAILED` instead of behaving idempotently. Confirmed against real AWS that `DeleteIndex` on a missing index returns `NotFoundException` — the same shape `_getIndex` already special-cases. Because the cache clear (`_validatedIndexInfo = null`, `_indexEpoch++`) ran only on a *successful* delete, a stale cache from an earlier write on the same instance was also left unreconciled when the delete instead revealed the index was already gone; it now runs in both cases.

**Cancellation and cost:**

- `similaritySearchWithScore` validated only `k` before embedding, so an already-aborted signal still paid for a full, uncancellable, billable `embedQuery` call before failing — contradicting the README's documented pre-abort behaviour, and inconsistent with `addDocuments`, which has guarded its analogous `embedDocuments` call since 0.6.0. Filter validation had the same shape, running after the embed call even though it is exactly as cheap and synchronous as the `k` check deliberately hoisted above it. Both now run first, covering all three text-search entry points.
- `similaritySearchWithRelevanceScores` placed `signal` in the parameter slot every other text-based method reserves for `Callbacks`, so a caller following that house pattern — `(query, k, filter, undefined, signal)` — had cancellation silently dropped. The review attributed this to generic `VectorStore` callers; that mechanism does not hold, since `@langchain/core`'s `VectorStore` does not declare this method at all. The house-pattern inconsistency is the reproducible defect.

**Validation gaps:**

- Neither `similaritySearchVectorWithScore` nor `similaritySearchByVector` checked that the query vector was an array; a non-array reached AWS as a malformed `float32` payload. Now validated in `_queryVectors`, where both entry points converge.
- 0.7.0 extended the per-batch dimension check to every batch, but only for *within-batch* consistency — a later batch was still never checked against the actual index dimension, since only batch 0 goes through `_validateBeforeWrite`. A uniformly-wrong-dimension later batch therefore reached `PutVectors` and surfaced AWS's generic `ValidationException` instead of the coded `INDEX_CONFIG_MISMATCH` the identical mistake gets in batch 0. Batch 0 has already cached the index's dimension by then, so later batches are now checked for free.

**Data preservation:**

- `createDocument` deleted the `pageContentMetadataKey` entry unconditionally after reading it, so a *non-string* value under that key — reachable when something other than this library writes to the same index — vanished from the returned metadata entirely. The empty `pageContent` for that case is intentional and tested; losing the raw value with no flag was not. The key is now deleted only when its value was actually consumed as page content.

**Diagnostics and code quality:**

- The empty-batch validation message fired for a one-item batch containing a zero-dimensional vector — the only case that can actually reach it, since both write methods return early on empty input and `chunk()` never yields an empty batch. Reworded to name both possibilities without misattributing the cause.
- `getByIds` inferred "this batch has duplicate ids" from the response map being smaller than the request, which is also true when an id is simply missing — triggering a `structuredClone` on a result the missing-id throw discards anyway. Now compared against a `Set` of the requested ids. No behavioural change; the wasteful clone could never reach a caller.
- `_createIndex` declared an `AbortSignal` parameter no caller ever populated. Its only caller, `_ensureIndexExists`, deliberately never passes one — that GetIndex/CreateIndex work is shared across concurrent writers and no single caller may cancel it out from under the others — so the parameter implied a cancellability that does not exist and only ever forwarded a literal `undefined`.

### Notes on verification

Two findings cannot be reproduced against a correctly-functioning AWS endpoint, by nature rather than for lack of effort. The response-guard fixes (`distance`, `distanceMetric`, `_getIndex`) require a malformed response: AWS and Smithy omit absent optional fields rather than emitting a literal `null`, so only a mocked, stubbed, or non-conforming custom client can produce the triggering input — which is exactly the scenario the code's own error messages name. The page-limit fix would need more than 10,000 real indexed vectors under a filter selective enough to under-fill 100 consecutive pages. Both are covered by unit tests. What the live suite does confirm is the inverse: real `QueryVectors` responses always carry a finite numeric `distance` and a `distanceMetric` of `cosine`/`euclidean`, so the new guards do not misfire against the real service.

## [0.7.0] - 2026-08-28

### Added

- Documented that `QueryVectors` pagination doesn't preserve partial results on a mid-pagination failure, unlike every write/delete/get path in this library — a reasonable asymmetry (a failed search is side-effect-free and trivially retryable, unlike a failed write) that was previously undocumented.
- Unit test coverage for `delete({ deleteAll: true })` racing a write that has already passed local validation and is inside its actual `PutVectors` network call — previously only the race against this library's own local index-validation cache was covered (the existing "index-validation cache — concurrency" tests gate `GetIndexCommand`; the new ones gate `PutVectorsCommand` itself). A mocked client can't prove what AWS itself does with an orphaned `PutVectors` call, but the new tests prove this library's own state machine doesn't hang, crash, or resurrect a cleared cache under either a resolve-late or reject-late ordering.

### Fixed

- `similaritySearchVectorWithScore` defaulted a missing per-result `distance` to `0` — the *best possible* cosine relevance score — silently ranking a malformed result first instead of surfacing an anomaly, inconsistent with this same file's fail-closed handling of a missing `distanceMetric` (added in 0.5.0). This default dates back to 0.2.0; `returnDistance: true` is always requested, so a missing `distance` now throws a coded `AWS_INVALID_RESPONSE` error instead.
- The per-batch vector-dimension-consistency check — introduced in 0.4.0 with a documented "only the first batch is checked" limitation, then extended in 0.6.0 to check all of that first batch's vectors (not just `vectors[0]`) — still only ran on batch 0 of a multi-batch `addVectors` call. A caller-constructed batch 2+ with an internal dimension mismatch reached `PutVectors` unchecked, surfacing AWS's own less-specific validation error instead of this library's coded `INDEX_CONFIG_MISMATCH`. Now checked for every batch, closing the original 0.4.0 limitation for good.
- The constructor's `client` identity check used `Object.prototype.isPrototypeOf.call(S3VectorsClient.prototype, ...)` (added in 0.6.0), which shares `instanceof`'s weakness: a bundler duplicating `@aws-sdk/client-s3vectors` across a module boundary would make a legitimately-valid pre-configured client fail the check and get silently replaced with a freshly-built one. Now checks `config.client.config.serviceId === 'S3Vectors'` — a value baked into the client at construction, not tied to a specific copy of the class's prototype — while still accepting a subclassed client (e.g. a tracing wrapper) exactly as before.
- The README's "Concurrency" section claimed `delete({ deleteAll: true })` racing an in-progress write had been "verified to fail cleanly" (since 0.4.0) — that was never actually backed by a test, unit or live-AWS, only inferred from reading the code. Reworded to say precisely what's now true: unit tests cover the write once it's already past local validation and inside its actual `PutVectors` call, confirming this library's own state doesn't corrupt or hang under either ordering — live-AWS confirmation of this exact interleaving still doesn't exist.

## [0.6.0] - 2026-08-27

### Fixed

**Error-contract fixes** (every failure is supposed to surface as a coded `S3VectorsError` — these closed the cases where it didn't):

- `maxMarginalRelevanceSearch` was never implemented (only documented as unsupported), so a direct call threw a raw, uncoded `TypeError` instead of this library's own `S3VectorsError` — contradicting the guarantee that every failure is typed. Now explicitly defined; always rejects with a new coded error, `NOT_IMPLEMENTED`.
- `_getIndex` destructured `GetIndexCommand`'s response via a type-cast with no runtime check that `index`/`dimension`/`distanceMetric` were actually present (all three are independently optional per the AWS SDK's own types) — a response missing any of them threw a raw `TypeError` miscategorized as `AWS_REQUEST_FAILED`. Now throws a new coded error, `AWS_INVALID_RESPONSE`, with a clear diagnosis.
- `isError` (used internally to normalize a raw thrown value into an `Error`) missed `DOMException` and any other `Error` subtype that defines its own `Symbol.toStringTag` — it matched only the exact `Object.prototype.toString` tag `'[object Error]'`. A caller-supplied `embedDocuments` throwing a `DOMException` (e.g. from a native `fetch`/`AbortController`) had its real message replaced with `{}`. Now detects any value with string `name`/`message` properties, matching this repo's existing duck-typing convention (`isAbortError`, `isAwsNotFoundException`) instead of a tag check.
- `safeStringify` (used in the same error-normalization path) silently returned the literal value `undefined` — not a string — for a thrown `undefined`, function, or symbol, since `JSON.stringify` returns `undefined` rather than throwing for those inputs. A caller doing `throw undefined` produced an error message with the real cause silently dropped (`"<operation> failed: "` instead of `"<operation> failed: undefined"`).
- `createDocument`'s `structuredClone` call (used when `getByIds` detects duplicate ids in a batch) could throw an uncaught, uncoded exception for any non-structured-cloneable metadata value (e.g. a function, reachable via a custom client). Now caught and re-thrown as a coded `S3VectorsError`.
- Failures that never touched AWS — a raw throw from a caller-supplied `embeddings` model, or caller input malformed enough to bypass validation entirely (e.g. a non-array `documents` argument to `fromDocuments`) — were reported with the `AWS_REQUEST_FAILED` code, even though no AWS request was ever made. Added a new code, `S3VectorsErrorCode.UNEXPECTED_ERROR`, specifically for this case; `AWS_REQUEST_FAILED` is now reserved for an actual AWS S3 Vectors request failing.

**Validation gaps:**

- Only `vectors[0]` of a batch's write was dimension-checked against the index — a later vector in that *same* first batch with a mismatched dimension reached `PutVectors` unchecked, surfacing as a raw AWS `ValidationException` instead of the coded `INDEX_CONFIG_MISMATCH` every other dimension mismatch already produces. (Distinct from the existing, still-open "later batches aren't checked" limitation — this closes a gap *within* the one batch that was supposed to be fully checked.)
- `buildPutMetadata`/`createDocument` tested for the reserved `pageContentMetadataKey` with the `in` operator, which matches inherited `Object.prototype` properties (`constructor`, `toString`, etc.), not just a document's own metadata — configuring `pageContentMetadataKey: 'constructor'` made the store throw "reserved key" on every write regardless of actual metadata. Switched to `Object.hasOwn`.
- Creating an index with `nonFilterableMetadataKeys` already at or over AWS's 10-key cap *and* already including the page-content key threw "Cannot add pageContentMetadataKey" even though nothing was actually being added — the real (pre-existing, caller-side) problem was being misattributed to this library's auto-add step. Now only throws when the page-content key is genuinely new to the caller's list.
- The constructor's `client` validation only checked for a `.send` function, silently accepting any object shaped like an AWS SDK client (even the wrong service's client) as `this._client`, and silently discarding an invalid one with no diagnostic. Now checks the object's actual class identity (`Object.prototype.isPrototypeOf.call(S3VectorsClient.prototype, ...)` — `instanceof` is disallowed in this codebase, and calling `.isPrototypeOf(...)` directly is disallowed by `no-prototype-builtins` — this also correctly accepts a legitimate `S3VectorsClient` subclass, e.g. a tracing wrapper) and logs a `console.warn` when falling back.
- `_validateFilter`'s empty-filter guard skipped arrays entirely (forwarding `[]` straight to AWS instead of rejecting it locally) and mis-detected any non-plain-object filter (`Map`, `Set`, a class instance) as an empty object via `Object.keys().length === 0`. Now does a proper plain-object shape check first, with a distinct message for each rejected shape. Reachable by ordinary typed callers, not just untyped ones — `Record<string, unknown>` does not structurally exclude arrays or `Map`/`Set`.
- `addVectors`, `addDocuments`, `addTexts`, `delete({ ids })`, `getByIds`, and `fromTexts` never checked that their array-typed argument (`vectors`/`documents`/`texts`/`ids`) was actually an array before calling array methods on it — a non-array value (reachable from an untyped JS caller, or a cast past the type system) surfaced as a raw, uncoded `TypeError` instead of this library's own coded `S3VectorsError`, and for `addVectors` specifically, with no wrapping at all. All six now reject a non-array argument up front with a clear `VALIDATION` error. `addTexts`'s optional `metadatas` argument had the same gap for a truthy non-array value (previously either a raw `TypeError` deeper in, or a confusing "must match number of texts (undefined)" message) — now validated too, when provided.

**Data-consistency fixes** (partial-failure reporting was silently losing information):

- `getByIds` used `Promise.all` per concurrency group instead of the `Promise.allSettled` every sibling batched method (`delete`, `addDocuments`, `addVectors`) already uses — a single batch failure discarded all information about ids found in sibling batches that succeeded in the same group. `S3VectorsErrorContext` gained `foundIds`, populated the same way `writtenIds`/`deletedIds` already are.
- `fromDocuments`/`fromTexts` constructed their `AmazonS3Vectors` instance purely locally and discarded it on a partial-write failure — the thrown error's `context.writtenIds` named ids already durably written, but the caller had no store handle to act on them without manually reconstructing an equivalent instance. `S3VectorsErrorContext` gained `instance`, set on any error these two factories throw.

**Concurrency fixes:**

- `addDocuments` checked the abort signal before every batch group except the very first — an already-aborted signal still paid for one full, billable, uncancellable `embedDocuments` call on the first batch before the operation failed. Now checked before the first batch too.
- A concurrent `delete({ deleteAll: true })` could be silently undone by a write already in flight: the write's post-await cache assignment never re-checked for an intervening deletion, so it could overwrite the delete's cache clear with stale pre-delete index info. Added a generation counter (`_indexEpoch`), bumped on every `deleteAll`, that a write's cache commit now checks before writing.
- The shared in-flight promise memoizing concurrent index-creation attempts only threaded the *first* caller's `AbortSignal` into the underlying `GetIndex`/`CreateIndex` calls — that caller's abort cancelled every concurrent sibling's write too, even ones with no signal of their own. The shared calls are no longer tied to any single caller's signal; each caller now races its own wait against its own signal instead.

## [0.5.0] - 2026-08-26

### Added

- `AbortSignal` support on every method that calls AWS — `addVectors`, `addDocuments`, `addTexts`, `delete`, `getByIds`, all `similaritySearch*` methods, and the `fromTexts`/`fromDocuments` static factories. An aborted operation rejects with a new coded error, `S3VectorsErrorCode.ABORTED`, distinct from `AWS_REQUEST_FAILED`. Confirmed live: aborting mid-write cancels the AWS request actually in flight rather than waiting for it to finish, and a signal that's already aborted before the call starts rejects immediately with no network call. `embedDocuments`/`embedQuery` have no cancellation support in LangChain's `EmbeddingsInterface`, so a batch already being embedded when the signal fires still completes; `addDocuments` checks the signal before starting the next batch's embedding so it doesn't pay for that expensive, uncancellable call for a write nobody wants anymore.
- `addVectors` and `addDocuments` now dispatch `PutVectors` calls for batches after the first concurrently (up to 10 in flight at once, the same concurrency `delete()`/`getByIds()` already use), instead of awaiting each batch sequentially in a loop. `addDocuments` keeps `embedDocuments` strictly sequential across batches — never called concurrently for two batches, since most embedding providers rate-limit aggressively and this library gives no retry/backoff guarantee for that call — while still dispatching that batch's `PutVectors` call without waiting for it to finish before embedding the next one. Confirmed live with 2,500 documents, including correct id/pageContent/metadata pairing preserved across concurrent batches.
- Published sourcemaps (`dist/*.js.map`) now embed the original TypeScript source directly (`inlineSources: true`) instead of pointing at `../src/*.ts`, a path that doesn't exist in the published package (`files` in `package.json` only ships `dist`, `LICENSE`, `README.md`). Previously, stepping into this library's code in a debugger produced a dead link; source is now available without also having to ship `src/` in the package.
- Documented the exact metadata size limits confirmed live — 2048 bytes filterable per vector, 40,960 bytes total per vector (both KiB-exact, matching AWS's own error text) — along with why no client-side pre-flight check exists for them: probing shows the true byte count AWS measures isn't a simple `JSON.stringify(...).length` of the metadata object or of the value alone, and reproducing an unpublished algorithm risks rejecting metadata AWS would have accepted.

- CI hardening: `CodeQL` (`.github/workflows/codeql.yml`) runs static analysis on every push/PR to `main` plus a weekly schedule; `Dependency Review` (`.github/workflows/dependency-review.yml`) fails a PR that introduces a high-severity-or-worse vulnerable dependency; `OpenSSF Scorecard` (`.github/workflows/scorecard.yml`) publishes a security-practices score to the public Scorecard dataset weekly and on push to `main`. The release workflow now also generates a CycloneDX SBOM (via npm's own built-in `npm sbom`, no extra third-party action) for the exact package version being published and attaches it to the GitHub Release.
- **Partial-batch write/delete failures now report what already succeeded.** `S3VectorsErrorContext` gained `writtenIds`/`deletedIds`. If `addVectors`/`addDocuments` fails partway through a multi-batch write, the thrown error's `context.writtenIds` lists every id confirmed durably written before the failure — including a concurrent batch that succeeded alongside the one that failed (found by waiting out every sibling in a concurrency group via `Promise.allSettled` instead of racing ahead on the first rejection with `Promise.all`, which would otherwise lose a slower sibling's success). Previously this information was simply gone: with auto-generated ids specifically, a partial write left orphaned vectors in AWS with no way to discover, clean up, or reconcile them, ever. Confirmed live against real AWS with a genuinely AWS-rejected batch (wrong vector dimension). `delete({ ids })` reports the equivalent `context.deletedIds` on a partial failure.
- `addVectors`/`addDocuments` now use each document's own `id` as the vector's key when `options.ids` is omitted, falling back to a fresh UUID only for documents with no `id` of their own — enabling a natural `getByIds` → modify → `addDocuments` upsert round trip. This is a deliberate departure from the Python `langchain-aws` reference (verified: it never inspects `document.id`, only `options.ids` or a fresh UUID) — not a parity gap, since it doesn't change wire format or stored data shape, only which id gets used when the caller didn't specify one.

### Changed

- Writing to an index with `createIndexIfNotExist: true` (the default) now caches the index's dimension/metric for the store instance's lifetime after the first successful write, the same way `createIndexIfNotExist: false` already did. Previously only the `false` path cached this (`_validatedIndexInfo`); the default path's memoization (`_ensureIndexPromise`) only ever covered concurrent callers racing at the same instant, not sequential calls, so every single write on the default config paid for a `GetIndexCommand` round trip. Confirmed live: 5 sequential `addDocuments` calls dropped from 5 `GetIndexCommand` calls to 1. Fewer round trips also reduces AWS throttling probability on write-heavy workloads.
- The read-path distance-metric guard in `similaritySearchVectorWithScore`/`similaritySearchByVector` now fails closed instead of open: if a `QueryVectors` response is ever missing `distanceMetric`, the search now throws an `INDEX_CONFIG_MISMATCH` error instead of silently skipping the metric-mismatch check. Confirmed live across three response shapes (empty index, filtered to zero results, and a normal match) that `distanceMetric` is always present, so this closes a theoretical silent-wrong-relevance-score risk without a live-observed false-positive risk.
- `isS3VectorsError` is now a proper TypeScript type guard (`value is S3VectorsError`) instead of returning a plain `boolean`. Previously every TypeScript consumer had to cast (`e as S3VectorsError`) after a passing `isS3VectorsError(e)` check, since the compiler had no way to narrow `unknown` from a boolean-returning function.

### Fixed

- The `README.md` retriever example suggested `searchType: "similarity_score_threshold"` as a configurable option in a comment. That value isn't valid for `@langchain/core@1.2.9`'s `asRetriever()` (`"similarity" | "mmr"` are the only two), and the only real alternative, `"mmr"`, throws at call time in this store specifically (Maximal Marginal Relevance is intentionally not implemented). Replaced with an accurate note instead of a misleading example.
- The README's Node.js version badge said `>=22.14` — stale since the `engines.node` floor was lowered to `>=20` in a previous release; the "Runtime Requirements" section already had the correct value.

## [0.4.0] - 2026-08-26

### Changed

- **BREAKING:** `delete()` now requires either an `ids` array or `{ deleteAll: true }` — calling `delete()` (or `delete({})`) with neither now throws instead of deleting the entire index. Closes a footgun where an accidentally-`undefined` `ids` variable would silently wipe the whole index. Passing both `ids` and `deleteAll: true` together also now throws, instead of silently ignoring `deleteAll`.
- **BREAKING:** `@aws-sdk/client-s3vectors` and `@langchain/core` are now declared only as `peerDependencies` (previously also listed in `dependencies`, which could cause npm to install a second, version-mismatched copy of either package nested inside this package's own `node_modules` — e.g. a duplicate `@langchain/core` whose `Document` class has different identity from the consuming app's own `Document`). Install both alongside this package, as the README already documents.
- **BREAKING:** `credentials` in `AmazonS3VectorsConfig` is now typed as `S3VectorsClientConfig['credentials']` (`AwsCredentialIdentity | AwsCredentialIdentityProvider`, sourced from the peer-declared `@aws-sdk/client-s3vectors`) instead of `any`. A TypeScript consumer passing a value that isn't structurally one of those two shapes now gets a compile error. Previously sourced the type from `@smithy/types` directly, which isn't a declared dependency and could fail to resolve under strict package managers (pnpm's isolated layout, Yarn PnP).
- Lowered the `engines.node` floor from `>=22.14.0` to `>=20`. The `>=22.14.0` floor was mistakenly justified by an unrelated *publish-time* requirement (npm Trusted Publishing needs npm CLI ≥11.5.1, which ships with Node ≥24 — that only affects the release workflow, never the published package's runtime). Both peer dependencies already require only Node ≥20, and no code in this package uses a Node 22+-only API. CI now also tests against Node 20.
- CI (`ci.yml`) now also runs on pull requests targeting `main`, not just pushes to `main`.
- `k` must now be a positive integer for every similarity-search method — matches the existing `batchSize` guard's pattern, and for the string-query methods (`similaritySearch`, `similaritySearchWithScore`, `similaritySearchWithRelevanceScores`) is checked before the query is embedded, so an invalid `k` doesn't cost a billable embedding call.
- The constructor now validates `vectorBucketName` against AWS's own documented naming rules (3–63 characters; lowercase letters, numbers, and hyphens only) instead of only rejecting an empty string — a malformed bucket name now fails fast and locally instead of surfacing as an opaque AWS `ValidationException` on the first API call.
- CI workflows now pin every third-party GitHub Action to a specific commit SHA (with the release version as a trailing comment) instead of a floating major-version tag. Dependabot's existing `github-actions` update job keeps these current automatically. `aws-actions/configure-aws-credentials` is pinned to `v6.2.3` (was `v6.0.0`), picking up an account-ID-allowlist validation hardening fix from `v6.2.1` as defense-in-depth (this repo's own usage doesn't set `allowed-account-ids`, so it wasn't exploitable here either way).
- `euclideanRelevanceScoreFn`'s and the README's relevance-score documentation no longer claim a [0, 1] output range for the euclidean case. Confirmed against the live service: S3 Vectors' `euclidean` distance is *squared* L2, not linear L2, so dividing it by a linear scale (inherited from the Python `langchain-aws` reference for parity) doesn't reliably bound the result the way the cosine conversion does — for normalized embeddings the score lands in a narrow band near 1 rather than spanning [0, 1], and can go negative for unnormalized ones. The formula is unchanged (parity is intentional); only the documented range was wrong.

### Added

- Existing-index validation: writing to an already-created index whose `dimension` or `distanceMetric` doesn't match this store's configuration now throws a coded `S3VectorsError` (`INDEX_CONFIG_MISMATCH`) instead of failing later with an opaque AWS error (dimension mismatch) or silently computing relevance scores against the wrong metric. Each concurrent writer — including concurrent callers racing to create a brand-new index, and a caller that loses a cross-*process* creation race (whose winner's actual committed dimension/metric is now re-fetched and validated against, instead of being skipped) — is validated against its own vector rather than sharing one caller's verdict; a caller's own empty batch is likewise never attributed to a different, concurrently-racing caller. The check now also runs when `createIndexIfNotExist: false` — fetched once via `GetIndex` and cached for the store's lifetime (cleared on `delete({ deleteAll: true })`), so this doesn't reintroduce the per-write `GetIndex` round-trip that flag exists to avoid. Similarity-search reads validate the distance metric too (AWS returns it on every `QueryVectors` response), since a mismatch there would otherwise silently compute a relevance score with the wrong formula and no write-path check ever runs for a read-only consumer. **Known limitation:** only the first batch of a multi-batch write is checked — a later batch with a mismatched dimension still surfaces as a raw AWS error rather than the coded one.
- `similaritySearchVectorWithScore`/`similaritySearchByVector` now page through `QueryVectors`' `nextToken` until `k` results are collected or the result set is exhausted. Previously a single `QueryVectors` call was made regardless of `k`, so requesting `k` greater than AWS's ~100-result page cap silently returned fewer documents than requested. The pagination loop is bounded at 100 round trips — confirmed against the live service that its page size is fixed (not caller-tunable or content-dependent: `topK` of 101, 1,000, and 10,000 each return exactly 100 results per page), and `topK` itself caps at 10,000, so 100 pages is the most any legitimate search could ever need. It deliberately does *not* stop early on an empty-but-`nextToken`-bearing page, since a heavily-filtered query can return one legitimately with real results still on a later page.
- `addDocuments` now throws if the embeddings model returns a different number of vectors than documents passed in, instead of silently re-pairing embeddings with the wrong documents/ids by index. `addVectors` already guarded this exact invariant for caller-supplied vectors; this is the same guard for the embeddings-model-supplied case (e.g. a provider that silently drops empty-string inputs).
- Creating an index now throws instead of silently creating one with page content missing from `nonFilterableMetadataKeys`, when the caller's own `nonFilterableMetadataKeys` is already at AWS's 10-key cap. Previously this fell back to the caller's list unchanged, which made page content *filterable* metadata (capped at 2 KB per vector) instead of non-filterable (40 KB) — with no way to fix it afterward, since S3 Vectors has no way to reconfigure an existing index's metadata configuration. The error message names the fix (trim the list, or set `pageContentMetadataKey: null`).
- `SECURITY.md` — vulnerability disclosure process.
- `CONTRIBUTING.md` — local development, coding standards, and PR expectations (expanded from the README's former inline "Contributing" section).
- `addVectors`/`addDocuments` now validate a mismatched `ids` array length *before* the empty-input short-circuit, instead of after it. Previously `addVectors([], [], { ids: ['a', 'b'] })` (and the `addDocuments` equivalent) silently returned `[]`, swallowing what a non-empty batch would have correctly rejected as a caller mistake.
- `batchSize` is now validated against AWS's actual per-call ceiling for each operation (`addVectors`/`addDocuments`: 500, matching `PutVectors`; `delete`: 500, matching `DeleteVectors`; `getByIds`: 100, matching `GetVectors`), confirmed live against the real service. `k` is likewise validated against AWS's `topK` ceiling of 10,000. Both previously relied on AWS's own validation error, several round trips away from local, `batchSize`/`k`-must-be-a-positive-integer-style validation.
- Documented S3 Vectors' actual accepted metadata value types (strings, numbers, booleans, and homogeneous arrays of strings/numbers) in the README, along with two silent-coercion behaviors confirmed live and worth knowing about: a `Date` value round-trips as a plain number (Unix epoch **seconds**, not milliseconds), and `NaN` round-trips as the string `"NaN"` — neither errors, both quietly change the value's type. `null` and nested objects are rejected outright by AWS.
- A new live integration test (`bugfix-verification.test.ts`) covers two genuinely separate `AmazonS3Vectors` instances racing to create the same new index — confirmed against real AWS that the losing instance's `ConflictException` is recovered from correctly. The existing same-instance race test only ever exercises this store's in-process memoization (`_ensureIndexPromise`), since a single instance only ever issues one `CreateIndex` call; this is the one that actually exercises the cross-process recovery path live.
- `similaritySearch`/`similaritySearchVectorWithScore`/etc. now reject an empty filter object (`{}`) locally instead of forwarding it to AWS, which rejects it with an opaque "Invalid filter" error rather than treating it as "no filter" (confirmed live). Omit the `filter` argument (or pass `undefined`) to search without filtering.
- Confirmed live with 5 concurrent, entirely separate `AmazonS3Vectors` instances racing to create the same new index (not just 2) — all succeed, with the `ConflictException` recovery path holding up beyond the smallest possible race. Added as a permanent live integration test.
- Documented (README, "Metadata Filtering" and new "Concurrency" sections) three more behaviors confirmed live: a type-mismatched filter comparison silently returns zero results rather than erroring; filtering on a non-filterable metadata key fails with a clear AWS error; and `delete({ deleteAll: true })` racing an in-progress write causes that write's remaining batches to fail with a plain "index not found" error rather than being coordinated — verified to fail cleanly, with no data corruption or hang, but not specially handled.

## [0.3.2] - 2026-08-26

### Changed

- Upgraded all dependencies to their current versions, including `@aws-sdk/client-s3vectors` (`^3.1117.0`), `@langchain/core` (`^1.2.9`), and the full devDependency set.
- `typescript` now resolves via the `@typescript/typescript6` compatibility package, since TypeScript 7's native Go compiler doesn't yet expose a stable API and `ts-jest`, `typescript-eslint`, and `typedoc` all still depend on the JS-based one. A separate `@typescript/native` devDependency tracks real TypeScript 7 for future adoption once tooling support catches up.
- Migrated the `cpd:full`/`cpd:test` scripts to jscpd v5's CLI: the `full` reporter is now `console-full`, and the removed `--verbose` flag was dropped.
- Bumped `actions/checkout` and `actions/setup-node` to v7 across all GitHub Actions workflows.
- The default page-content metadata key (`_page_content`) is now automatically added to `nonFilterableMetadataKeys` when this library creates a new index (unless `pageContentMetadataKey` is `null`, or the key is already listed). Filterable metadata is capped at 2 KB per vector by S3 Vectors; document text stored as ordinary filterable metadata could exceed that cap. This only affects indexes created by this library going forward — existing indexes are unaffected, since non-filterable keys can't be changed after index creation.
- `similaritySearch()` (and therefore `asRetriever()`) now embed queries using the configured `queryEmbeddings` model when one is set, instead of always using the indexing embedding model.
- `addDocuments`/`addTexts`/`fromTexts`/`fromDocuments` now throw a coded `S3VectorsError` (`EMBEDDINGS_MISSING`) instead of a plain `Error` when no embedding model is configured.
- `fromDocuments`/`fromTexts` now forward a `batchSize` option through to the underlying `addDocuments` call.
- `fromTexts` now validates that a `metadatas` array's length matches the `texts` array's length (previously silently truncated or padded with `{}`), matching `addTexts`'s existing behavior.
- Document metadata that already uses the reserved `pageContentMetadataKey` (default `_page_content`) now throws instead of being silently overwritten.
- `batchSize: 0` or a negative `batchSize` now throws instead of looping forever.
- Concurrent `addVectors`/`addDocuments` calls against a not-yet-existing index no longer race on `CreateIndex`.
- `delete`/`getByIds` now issue their batch AWS calls with bounded concurrency (up to 10 in flight at once) instead of strictly sequential — faster for large ID lists without risking AWS's per-index request-rate limits.
- `batchSize` must now be a positive **integer** (not just non-negative) for `addVectors`/`addDocuments`/`delete`/`getByIds` — a non-integer value like `1.5` now throws the same `batchSize must be a positive integer` error.
- `_createIndex` no longer sends an empty `metadataConfiguration.nonFilterableMetadataKeys` array to `CreateIndex` (previously sent for an explicitly-passed empty array); it's omitted entirely when there's nothing to configure. The auto-added default page-content key is also skipped (falling back to exactly what was configured) if adding it would exceed S3 Vectors' 10-key non-filterable-metadata-key cap.

### Added

- `similaritySearchWithRelevanceScores(query, k?, filter?)` — applies `relevanceScoreFn` (or the built-in cosine/euclidean converter) to search results, previously configurable but unused by any method.

## [0.3.1] - 2026-05-31

### Added

- Typed `S3VectorsError` carrying a `code` (`S3VectorsErrorCode`) and a `context` (`{ operation, vectorBucketName, indexName }`), plus the `isS3VectorsError` guard — all exported from the package root.
- `maxAttempts` and `retryMode` config options, forwarded to the AWS SDK retry strategy (throttling/5xx retries are handled by the SDK).
- Early validation of `vectorBucketName` and `indexName` in the constructor (fails fast before any AWS call).
- 100% statement/branch/function/line coverage, enforced by the Jest threshold in CI.
- VectorStore contract tests (including `asRetriever()`), property-based tests (`fast-check`), a packaged-tarball smoke test, and compile-time public-API type tests.
- Standalone real-AWS verification scripts under `examples/` (real Amazon Bedrock Titan Text Embeddings V2), and a nightly scheduled live-AWS smoke workflow via GitHub OIDC.

### Changed

- All failures — validation, not-found, missing-embeddings, and underlying AWS request errors — are now surfaced as `S3VectorsError`. Error messages are unchanged.

### Removed

- Stryker mutation-testing scaffold (`stryker.conf.json`, `test:mutate` / `test:mutate:quick` scripts, and the `@stryker-mutator/*` devDependencies).

## [0.2.0] - 2026-04-18

### Added

- Integration test infrastructure (`jest.integration.config.cjs`, `test/integration/`) with env-gated live-AWS runs (`RUN_LIVE_INTEGRATION=1`, `AWS_VECTOR_BUCKET`). LocalStack does not support the `s3vectors` service ([localstack/localstack#13498](https://github.com/localstack/localstack/issues/13498)), so integration coverage runs against a real AWS vector bucket.
- On-demand live-AWS CI workflow `.github/workflows/integration-live.yml` using GitHub OIDC to assume an IAM role (`AWS_ROLE_TO_ASSUME`).
- Stryker mutation testing scaffold (`stryker.conf.json`, `test:mutate`, `test:mutate:quick`). Note: a known ESM+jest+Stryker interaction currently prevents test discovery inside Stryker's sandbox; the scaffold is in place for when that resolves.
- CI workflow `.github/workflows/ci.yml` on push to main: matrix of 3 OS (Ubuntu/Windows/macOS) × Node 22/24 with lint, typecheck, test, build, and `npm audit` jobs. CI does not run on pull requests.
- npm publishing with provenance attestations via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) — no long-lived `NPM_TOKEN`, automatic provenance.
- `aws-sdk-client-mock` as the unit-test mocking library (AWS-recommended for SDK v3). 5 new tests cover previously-uncovered error branches.
- Repo hygiene: `CODE_OF_CONDUCT.md` (Contributor Covenant), `CHANGELOG.md`, `.nvmrc`, `.gitattributes`, `.depcheckrc`, `.prettierignore`.
- `src/shared/` module with extracted internal helpers (`stub-embeddings`, `errors`, `metadata`).

### Changed

- **BREAKING:** Node engines raised from `>=20` to `>=22.14.0`. Node 22.14 is the minimum required by npm Trusted Publishing.
- **BREAKING:** `npm >=10.0.0` is now declared in `engines`.
- Upgraded TypeScript 5.9 → 6.0 with stricter tsconfig (retains `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`; explicit `types: ['node']` as required by TS 6).
- Upgraded `typedoc` 0.28.17 → 0.28.19 (TS 6 support, resolves transitive `handlebars` critical CVE).
- Upgraded `ts-jest` 29.4.6 → 29.4.9 (TS 6 support).
- Converted `eslint.config.js` to `eslint.config.ts` loaded via `jiti`.
- Renamed test directory `tests/` → `test/`; split the monolithic test file into 10 feature-scoped files.
- Raised unit-test coverage thresholds from 75/80/80 to 80/80/80/80. Current coverage: 96% statements, 84.76% branches, 91.89% functions, 97.03% lines.
- Decomposed `src/s3-vectors.ts` (629 → 478 lines): extracted internal helpers to `src/shared/` and renamed `src/utils.ts` → `src/relevance-scores.ts`. **Public API unchanged.**
- Converted Jest config files from TypeScript to CommonJS (`jest.config.cjs`, `jest.integration.config.cjs`) to remove the `ts-node` dependency.

### Removed

- Hand-rolled `{ send: jest.fn() }` mock helper, replaced by `aws-sdk-client-mock`'s typed `mockClient()` API.
- `ts-node` devDependency (no longer needed after Jest config conversion to CJS).
- `globals` devDependency (was unused).

### Fixed

- None (Phase 3 refactor is no-behavior-change; all new tests pass on the existing implementation).

## [0.1.0] - 2026-03-22

- Initial release.
