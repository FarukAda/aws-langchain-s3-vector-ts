# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING:** `delete()` now requires either an `ids` array or `{ deleteAll: true }` — calling `delete()` (or `delete({})`) with neither now throws instead of deleting the entire index. Closes a footgun where an accidentally-`undefined` `ids` variable would silently wipe the whole index. Passing both `ids` and `deleteAll: true` together also now throws, instead of silently ignoring `deleteAll`.
- **BREAKING:** `@aws-sdk/client-s3vectors` and `@langchain/core` are now declared only as `peerDependencies` (previously also listed in `dependencies`, which could cause npm to install a second, version-mismatched copy of either package nested inside this package's own `node_modules` — e.g. a duplicate `@langchain/core` whose `Document` class has different identity from the consuming app's own `Document`). Install both alongside this package, as the README already documents.
- Lowered the `engines.node` floor from `>=22.14.0` to `>=20`. The `>=22.14.0` floor was mistakenly justified by an unrelated *publish-time* requirement (npm Trusted Publishing needs npm CLI ≥11.5.1, which ships with Node ≥24 — that only affects the release workflow, never the published package's runtime). Both peer dependencies already require only Node ≥20, and no code in this package uses a Node 22+-only API. CI now also tests against Node 20.
- `credentials` in `AmazonS3VectorsConfig` is now typed as `S3VectorsClientConfig['credentials']` (sourced from the peer-declared `@aws-sdk/client-s3vectors`, matching `S3VectorsClient`'s own type) instead of `any`. Previously sourced the type from `@smithy/types` directly, which isn't a declared dependency and could fail to resolve under strict package managers.
- CI (`ci.yml`) now also runs on pull requests targeting `main`, not just pushes to `main`.

### Added

- Existing-index validation: writing to an already-created index whose `dimension` or `distanceMetric` doesn't match this store's configuration now throws a coded `S3VectorsError` (`INDEX_CONFIG_MISMATCH`) instead of failing later with an opaque AWS error (dimension mismatch) or silently computing relevance scores against the wrong metric.
- `similaritySearchVectorWithScore`/`similaritySearchByVector` now page through `QueryVectors`' `nextToken` until `k` results are collected or the result set is exhausted. Previously a single `QueryVectors` call was made regardless of `k`, so requesting `k` greater than AWS's ~100-result page cap silently returned fewer documents than requested.
- `SECURITY.md` — vulnerability disclosure process.
- `CONTRIBUTING.md` — local development, coding standards, and PR expectations (expanded from the README's former inline "Contributing" section).

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
