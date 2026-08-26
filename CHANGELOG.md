# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
