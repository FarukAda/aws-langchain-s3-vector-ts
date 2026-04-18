# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
