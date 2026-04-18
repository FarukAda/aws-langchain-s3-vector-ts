# Design: Parity Alignment with `aws-langgraph-dynamodb-ts`

**Status:** Draft (awaiting review)
**Date:** 2026-04-18
**Author:** Faruk Ada
**Target repo:** `@farukada/aws-langchain-s3-vector-ts`
**Sibling reference:** `@farukada/aws-langgraph-dynamodb-ts`
**Target version:** `0.2.0`

---

## 1. Summary

`@farukada/aws-langchain-s3-vector-ts` (hereafter "Project A") and `@farukada/aws-langgraph-dynamodb-ts` (hereafter "Project B") are production-grade npm packages under the same author. Project B has matured ahead of Project A in tooling, testing, CI/CD, repo hygiene, and documentation. This spec defines the work required to bring Project A to the same enterprise-grade quality bar as Project B, scoped for delivery as four sequenced local commits on a single working branch, culminating in a `v0.2.0` release published with npm Trusted Publishing and provenance attestations.

**Delivery model:** each phase lands as one local commit on the working branch. The working branch is pushed (and merged to `main`) at the author's discretion — not per phase. CI runs on `push` to `main` and on release tags, never on pull requests. Each phase's acceptance criteria MUST be verifiable locally on the author's machine before moving to the next phase.

This spec uses RFC 2119 keywords (MUST, SHOULD, MAY).

## 2. Motivation & constraints

### 2.1 Motivation

- Both packages are intended for enterprise adoption and MUST present a consistent quality bar to consumers evaluating them.
- Project A currently lacks CI, integration testing, supply-chain hardening (provenance), mutation testing, and multiple hygiene artifacts that Project B already has.
- `AmazonS3Vectors` must remain behaviorally faithful to the Python reference implementation at `langchain_aws.vectorstores.s3_vectors.base.AmazonS3Vectors`. Any architectural changes MUST NOT diverge Project A's observable behavior from that reference.

### 2.2 Hard constraint: LocalStack does not support `s3vectors`

The LocalStack emulator does not provide an `s3vectors` service implementation. This is tracked as a backlogged feature request at [localstack/localstack#13498](https://github.com/localstack/localstack/issues/13498) with no committed ETA.

**Consequence:** Project A cannot adopt Project B's `docker-compose`-based LocalStack integration testing pattern for its primary service. This spec adopts a different, equally rigorous strategy — see §6.

### 2.3 API stability

Project A is at `0.1.0` (pre-1.0). Breaking changes are permitted at minor bumps. Project A MAY reorganize its module boundaries. Project A MUST NOT change observable runtime behavior as part of this work (bug fixes out of scope).

### 2.4 Runtime support

Project A MUST align to Project B's Node engine requirement (`>=22.14.0`). The Node 22.14+ minimum is also required by npm Trusted Publishing (§8) and is therefore load-bearing, not cosmetic.

## 3. Success criteria (high-level)

A successful completion of this spec SHALL satisfy all of the following:

1. Every tooling and hygiene file that exists in Project B's root exists in Project A's root, with the same purpose and near-identical content (adjusted for Project A's ESM module format and single-feature scope).
2. CI runs on every `push` to `main` and on release tags, across OS matrix `{ubuntu-latest, windows-latest, macos-latest}` × Node `{22, 24}`. CI does not run on `pull_request` events.
3. `npm audit --omit=dev --audit-level=high` runs in CI and blocks on high/critical findings.
4. Unit test coverage meets or exceeds 80% for branches, functions, and statements.
5. Mutation testing via Stryker is installed and runnable; killed mutant ratio SHOULD exceed 80%, MUST exceed 60% to pass local review.
6. Integration tests runnable against real AWS, gated by environment variables, with a documented local-run procedure and a manually-dispatchable CI workflow.
7. `v0.2.0` published to the npm registry with an automatically generated provenance attestation (visible via the npm registry UI and `npm view` metadata).
8. README matches Project B in depth and covers: architecture, IAM, testing procedure, LocalStack limitation rationale, and contributor guidance.
9. No observable behavior change in the `AmazonS3Vectors` class from `0.1.0` to `0.2.0` (confirmed by an unchanged unit test suite, modulo import path updates and mock-library migration).

## 4. Non-goals

The following are explicitly out of scope:

- Semantic-release, changesets, or any other release automation beyond manual tag push.
- `CONTRIBUTING.md` (Project B does not have one).
- `SECURITY.md` (separate concern, separate piece of work).
- Dependabot / Renovate configuration (separate concern, separate piece of work).
- Porting the Python `AmazonS3VectorsRetriever` class.
- Backporting npm Trusted Publishing to Project B.
- Any functional or behavioral change to `AmazonS3Vectors` or its public surface.
- Publishing a documentation website or GitHub Pages site.
- Dependency version bumps in Project B.

## 5. Execution plan — phased delivery

Delivery is split into four sequenced local commits on a single working branch (suggested name: `feat/parity-alignment`). Each commit MUST pass local verification before the next commit is authored. The working branch is pushed and merged to `main` at the author's discretion — not per phase. The phased ordering is load-bearing: Phase 1 establishes tooling before Phase 2 relies on it; Phase 2's test migration is validated before Phase 3 refactors the source; Phase 4 prepares the release artifacts only after all prior phases are local-verified.

### Phase 1 — Hygiene & CI skeleton (commit #1)

**Scope:** Additive only; zero `src/` changes.

**Artifacts added:**

- `.nvmrc` — contents: `22`
- `.gitattributes` — LF normalization plus binary rules, ported from Project B
- `.depcheckrc` — ignore rules tailored to Project A's dev dependencies
- `.prettierignore` — standard ignore list
- `CODE_OF_CONDUCT.md` — Contributor Covenant, copied verbatim from Project B
- `CHANGELOG.md` — Keep-a-Changelog skeleton, empty `[Unreleased]` section
- `.github/workflows/ci.yml` — see §5.1.1 below

**Artifacts modified:**

- `eslint.config.js` → `eslint.config.ts` (flat config, ported from Project B); adds `jiti` devDep as the TypeScript config loader
- `tsconfig.json`:
  - `target: "ES2024"`
  - `noUncheckedIndexedAccess: true`
  - `noUnusedLocals: true`
  - `noUnusedParameters: true`
  - Explicit `"types": ["node", "jest"]` (required for TypeScript 6 — `@types` directories are no longer auto-included)
  - Preserve `"module": "NodeNext"` — Project A remains ESM
- `package.json`:
  - `engines.node: ">=22.14.0"`
  - `engines.npm: ">=10.0.0"`
  - `devDependencies.typescript: "^6.0.3"` (verify latest at implementation time)
  - `devDependencies.knip`, `jscpd`, `eslint-plugin-perfectionist`, `typescript-eslint` upgraded to latest major-compatible versions (verify at implementation time)
  - `devDependencies.jiti` added
  - `scripts.lint`: `"eslint \"src/**/*.ts\" \"test/**/*.ts\""` (no `--fix`)
  - `scripts["lint:fix"]`: `"eslint \"src/**/*.ts\" \"test/**/*.ts\" --fix"`
- `.gitignore` — add `.stryker-incremental.json`, `.stryker-tmp/`, `reports/`

#### 5.1.1 CI workflow — `.github/workflows/ci.yml`

**Triggers:** `push` to `main` only, plus `workflow_dispatch` for manual runs. The workflow MUST NOT include `pull_request` as a trigger — CI minutes should not burn on draft work.

**Jobs:**

1. `lint` — single ubuntu-latest, Node 22.14+; runs `npm ci && npm run lint && npm run typecheck`.
2. `test` — matrix `{ubuntu-latest, windows-latest, macos-latest}` × Node `{22, 24}`; runs `npm ci && npm test -- --ci && npm run build`.
3. `audit` — single ubuntu-latest, Node 22.14+; runs `npm ci && npm audit --omit=dev --audit-level=high`. Failures at `high` or `critical` MUST fail the workflow; moderate findings MUST NOT fail it.

**Concurrency:** workflow runs for the same ref cancel in-progress runs.

**Permissions:** `contents: read` at the workflow level; no write permissions.

**Action pins (verify at implementation time):** `actions/checkout@v6`, `actions/setup-node@v6`. The implementer MUST re-verify these are still the latest majors before merging.

#### 5.1.2 Phase 1 acceptance criteria (verifiable locally)

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass on the author's machine on Node 22.14+.
- The `.github/workflows/ci.yml` file passes a local static check (e.g., `actionlint` or equivalent) — confirming the workflow is well-formed without needing to execute it.
- No changes to `src/` files.
- No changes to test behavior; existing tests pass unmodified.
- Phase 1 is committed locally as a single commit on the working branch. The commit is NOT pushed as part of Phase 1's completion.

### Phase 2 — Test infrastructure migration (commit #2)

**Scope:** Test organization, tooling, and infrastructure. No `src/` changes.

#### 5.2.1 `aws-sdk-client-mock` migration (spike-gated)

The implementer MUST execute a verification spike before proceeding with the migration:

1. Install `aws-sdk-client-mock@^4.1.0`.
2. Write a single throwaway test that uses `mockClient(S3VectorsClient)`, resolves a `CreateIndexCommand` to a fixed response, rejects a `GetIndexCommand` with a `NotFoundException`, and asserts via the library's command matchers.
3. Run `npm test`. If the test passes and TypeScript types resolve correctly, proceed with the migration.
4. If the spike fails (typing errors, command-resolution issues, runtime bugs): **abort the `aws-sdk-client-mock` portion of Phase 2**, delete the spike, keep `tests/helpers.ts`'s hand-rolled mock as-is, and document the failure in the Phase 2 commit message plus a new feedback memory. Proceed with the remaining Phase 2 work.

Assuming the spike passes:

- `tests/helpers.ts` rewritten to export a thin factory over `mockClient(S3VectorsClient)`.
- Existing test assertions MUST NOT change beyond the helper call sites.

#### 5.2.2 Directory reorganization

- Rename `tests/` → `test/` (match Project B's convention).
- Split the current monolithic `test/s3-vectors.test.ts` into per-feature files:
  - `test/helpers.ts`
  - `test/constructor.test.ts`
  - `test/add-vectors.test.ts`
  - `test/add-documents.test.ts`
  - `test/add-texts.test.ts`
  - `test/similarity-search.test.ts`
  - `test/delete.test.ts`
  - `test/get-by-ids.test.ts`
  - `test/relevance-scores.test.ts`
  - `test/auto-index.test.ts`
  - `test/from-texts.test.ts`
  - `test/integration/.gitkeep`
- Each split file MUST contain the same `describe` blocks and `it` assertions as the original, unchanged.

#### 5.2.3 Integration testing

**Infrastructure decision:** no `docker-compose.yml` (see §2.2).

**`jest.integration.config.ts`:**

- `preset: 'ts-jest/presets/default-esm'` (Project A is ESM)
- `testMatch: ['<rootDir>/test/integration/**/*.test.ts']`
- `testTimeout: 120000`
- `maxWorkers: 1`
- `collectCoverage: false`
- `clearMocks: true`

**Scripts added to `package.json`:**

- `"test:integration": "node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.integration.config.ts"`

**Gating contract:** every integration test file MUST call a shared guard that skips the suite (via Jest's `describe.skip` or an early `return`) unless **both** `process.env.RUN_LIVE_INTEGRATION === '1'` **and** `process.env.AWS_VECTOR_BUCKET` is a non-empty string. Without both, the test run MUST exit with code `0` and print a single line explaining why tests were skipped.

**Initial integration test content:** at least one smoke test covering the happy path (create index → put vectors → query → delete index). Implementer MAY add more; the acceptance bar is that the suite runs successfully against a real bucket at least once before Phase 2 is considered complete.

#### 5.2.4 Mutation testing — Stryker

- `stryker.conf.json` copied verbatim from Project B with the `disableTypeChecks` glob adjusted to `"{src,test}/**/*.{ts,tsx}"` (already correct in Project B's copy).
- Thresholds: `high: 80`, `low: 60`, `break: 50`.
- Scripts:
  - `"test:mutate": "stryker run"`
  - `"test:mutate:quick"`: in Phase 2 (before the refactor) use `"stryker run --mutate src/utils.ts"`. In Phase 3, as part of the refactor commit, update this script to `"stryker run --mutate src/shared/**/*.ts"` alongside the directory rename. The script transitions atomically with the code it points at.
- devDependencies added: `@stryker-mutator/core`, `@stryker-mutator/jest-runner`, `@stryker-mutator/typescript-checker` (pinned to the same version, latest at implementation time).

#### 5.2.5 Coverage thresholds

`jest.config.ts`: `coverageThreshold.global` raised to `{ branches: 80, functions: 80, lines: 80, statements: 80 }`.

#### 5.2.6 Live-integration CI workflow — `.github/workflows/integration-live.yml`

**Trigger:** `workflow_dispatch` only. Never auto.

**Inputs:** optional `aws-region` (default `us-east-1`).

**Permissions:** `id-token: write`, `contents: read`.

**Steps:**

1. `actions/checkout@v6`
2. `actions/setup-node@v6` with Node 22.14+ and npm cache
3. `npm ci`
4. `aws-actions/configure-aws-credentials` — assumes `${{ secrets.AWS_ROLE_TO_ASSUME }}` via OIDC; implementer MUST pin the latest stable major at the time Phase 2 is authored (the action's version was not verified during spec authoring)
5. `npm run test:integration` with env `RUN_LIVE_INTEGRATION=1`, `AWS_VECTOR_BUCKET=${{ vars.AWS_VECTOR_BUCKET }}`, `AWS_REGION=${{ inputs.aws-region }}`

**Prerequisites NOT blocking Phase 2 completion:** the IAM role trust policy, the bucket, and the GitHub variable/secret MAY be configured after the working branch is pushed. Phase 2's acceptance bar is: the workflow file is syntactically valid (local lint), the gating logic has been proven locally, and the README's testing section (authored in Phase 4) will document the setup procedure.

#### 5.2.7 Phase 2 acceptance criteria (verifiable locally)

- All previously-passing unit tests still pass after helper swap (or hand-rolled helper retained if spike failed — documented in commit message).
- Tests split across ≥8 files; each file passes independently.
- `npm run test:integration` with `RUN_LIVE_INTEGRATION` unset exits `0` with skip message.
- `npm run test:integration` with required envs set runs at least one smoke test against real AWS successfully (author confirms; log retained for Phase 2's commit message or an adjacent note file).
- `npm run test:mutate` completes and reports ≥60% killed.
- Coverage at 80/80/80/80 with no regressions.
- Live-integration workflow file passes `actionlint` or equivalent local static check.
- Phase 2 is committed locally as a single commit on the working branch.

### Phase 3 — `src/` modular refactor (commit #3)

**Scope:** Internal reorganization. Zero behavior change. No test logic changes beyond import path updates.

#### 5.3.1 Target structure

```
src/
├── index.ts                         (public barrel — exports unchanged from 0.1.0)
├── s3-vectors.ts                    (slimmed AmazonS3Vectors class)
├── relevance-scores.ts              (renamed from utils.ts)
├── types.ts                         (unchanged)
└── shared/
    ├── stub-embeddings.ts           (StubEmbeddings, STUB_BRAND, isStubEmbeddings)
    ├── errors.ts                    (isAwsNotFoundException)
    └── metadata.ts                  (buildPutMetadata, createDocument as pure functions)
```

Directory named `shared/` for strict parity with Project B's convention.

#### 5.3.2 Refactor contract

- `buildPutMetadata` and `createDocument` become **pure functions** taking `pageContentMetadataKey` as an explicit parameter. The class's `_buildPutMetadata` and `_createDocument` methods are deleted; their call sites in `s3-vectors.ts` invoke the pure functions.
- `StubEmbeddings`, `STUB_BRAND`, `isStubEmbeddings` moved verbatim. Import updated in `s3-vectors.ts`.
- `isAwsNotFoundException` moved verbatim.
- `src/utils.ts` renamed to `src/relevance-scores.ts`; its exports (`cosineRelevanceScoreFn`, `euclideanRelevanceScoreFn`) unchanged.
- `src/index.ts` re-exports the same symbols as `0.1.0`. Consumer `import`s MUST resolve identically.
- The decomposition MUST NOT change: batch sizes, method signatures, thrown error messages, metadata serialization format, or any other consumer-observable behavior.

#### 5.3.3 Python reference alignment

The refactor preserves the Python `langchain_aws.vectorstores.s3_vectors.base.AmazonS3Vectors` reference's cohesion: the main class stays as one file. Helpers are extracted to `shared/` because they are orthogonal to the class's core responsibility (S3 Vectors API orchestration), not because they represent independent features.

#### 5.3.4 Phase 3 acceptance criteria (verifiable locally)

- Every test from Phase 2 passes with only import-path updates.
- `npm run build` emits a `dist/index.js` whose exported symbols match Phase 2's build (verify via `node -e 'console.log(Object.keys(require("./dist/index.js")))'`).
- `git diff --stat HEAD~1 HEAD -- test/` shows only import-path line changes.
- The refactored `src/s3-vectors.ts` is under 500 lines.
- Stryker run still passes its `low` threshold.
- Phase 3 is committed locally as a single commit on the working branch.

### Phase 4 — README, release automation, and `v0.2.0` (commit #4)

**Scope:** Documentation, release workflow, version bump, changelog.

#### 5.4.1 README rewrite

Target: 600+ lines, section structure matching Project B's depth. Sections in order:

1. **Header + badges** — npm version, CI status, Node ≥22.14, TypeScript, License, AWS SDK, sponsor (if applicable).
2. **Features** — retained and tightened.
3. **Architecture** — short narrative plus an ASCII diagram showing the data-flow `Consumer → AmazonS3Vectors → @aws-sdk/client-s3vectors → AWS S3 Vectors`. Explains batching, auto-index creation, and the `pageContentMetadataKey` convention.
4. **Quick Start** — minimal working example with Bedrock embeddings.
5. **Usage Examples** — text-based workflow, raw-vector workflow, separate query embeddings, custom relevance score fn.
6. **Infrastructure & IAM** — the minimum IAM policy (JSON) required for the store: `s3vectors:CreateIndex`, `PutVectors`, `QueryVectors`, `GetVectors`, `DeleteVectors`, `GetIndex`, `DeleteIndex`. Notes the bucket pre-creation requirement.
7. **Testing** — unit tests, mutation tests, integration tests. MUST explicitly state that LocalStack does not support `s3vectors` ([issue #13498](https://github.com/localstack/localstack/issues/13498)) and document the two alternative paths: `aws-sdk-client-mock` for unit coverage and optional live-AWS integration tests gated by `RUN_LIVE_INTEGRATION=1` + `AWS_VECTOR_BUCKET`. Includes the environment variable names, IAM role setup for the CI workflow, and the local-run command.
8. **Configuration** — cross-linked to TypeDoc.
9. **Project structure** — `src/` tree reflecting Phase 3's layout.
10. **API Reference** — link to TypeDoc output at `docs/`.
11. **Contributing** — brief; points to `CODE_OF_CONDUCT.md`.
12. **License** — retained.

#### 5.4.2 Release workflow — `.github/workflows/release.yml`

Project A adopts [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (GA since 2025-07). Trusted Publishing eliminates the long-lived `NPM_TOKEN` secret, issues publish credentials via short-lived OIDC tokens, and **automatically generates provenance attestations** without an explicit `--provenance` flag.

```yaml
name: Release NPM Package
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22.14.0'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --ci
      - run: npm run build
      - run: npm publish --access public
      - uses: softprops/action-gh-release@v3
        with:
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Action pins:** Implementer MUST re-verify all three action versions are still the latest majors before merging. Pinned values in this spec are correct as of 2026-04-18.

**Fallback:** If Trusted Publishing fails at tag time for any reason (misconfiguration on npmjs.com, OIDC outage), the implementer MAY revert the publish step to `npm publish --access public --provenance` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Provenance is still generated via the explicit flag. Document the fallback in a follow-up commit that restores Trusted Publishing once the issue is resolved.

**Pre-release manual steps (blocking the `v0.2.0` tag push):**

1. On [npmjs.com](https://www.npmjs.com/), for package `@farukada/aws-langchain-s3-vector-ts`, open **Settings → Trusted Publishers** and add a GitHub Actions publisher with:
   - Organization/user: `FarukAda`
   - Repository: `aws-langchain-s3-vector-ts`
   - Workflow filename: `release.yml`
   - Environment: none
2. Confirm the package `repository` field in `package.json` is set correctly (already the case).
3. Push the working branch to `main` (CI runs on push and must pass before tagging).

#### 5.4.3 CHANGELOG entry for `0.2.0`

Populate `[0.2.0]` with sections per Keep-a-Changelog:

- **Added:** integration test infrastructure (live AWS, gated); Stryker mutation testing; CI matrix (3 OS × Node 22/24); `npm audit` gate; OIDC Trusted Publishing with provenance; `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.nvmrc`, `.gitattributes`, `.depcheckrc`, `.prettierignore`; `shared/` module with extracted helpers.
- **Changed:** Node engines `>=20` → `>=22.14.0` (breaking for Node 20 users); TypeScript 5.9 → 6.0; ESLint config `.js` → `.ts`; test directory `tests/` → `test/`; source decomposed (public API unchanged); unit coverage thresholds 75%/80% → 80%/80%.
- **Removed:** hand-rolled mock client helper in `tests/helpers.ts` (replaced by `aws-sdk-client-mock`), if spike succeeded.
- **Fixed:** none expected (Phase 3 is no-behavior-change).

#### 5.4.4 Version bump

`package.json`: `0.1.0` → `0.2.0`.

#### 5.4.5 Phase 4 acceptance criteria

**Verifiable locally (before push):**
- README renders correctly in a local Markdown preview (headings, code blocks, badges, TOC links resolve).
- `CHANGELOG.md` `[0.2.0]` entry is complete and accurate.
- `package.json` version is `0.2.0`.
- Phase 4 is committed locally as a single commit on the working branch.

**Verifiable after push and tag (release-time):**
- Trusted Publisher is configured on npmjs.com (visible confirmation).
- CI workflow on `push` to `main` is green across the full matrix.
- Pushing tag `v0.2.0` triggers the release workflow; the workflow succeeds; the package appears on npm with a visible provenance attestation; the GitHub release is auto-created with generated notes.
- `npm view @farukada/aws-langchain-s3-vector-ts@0.2.0 --json` output contains provenance attestation metadata (exact field name verified at release time).

## 6. Integration testing strategy rationale

LocalStack's lack of `s3vectors` emulation forces a choice between three alternatives. This spec selects **`aws-sdk-client-mock` for unit coverage plus gated live-AWS integration tests**. Rationale:

- **Unit-level mocking** via `aws-sdk-client-mock` is the AWS-recommended pattern for SDK v3 and is already in use by Project B. Consistency with Project B is a first-class goal.
- **Live-AWS integration tests** provide the only path to verify real API behavior (response shapes, pagination, batching semantics, filter syntax, IAM enforcement). They are gated off by default because they incur AWS costs and latency and would unacceptably slow CI if run on every push.
- The manual-dispatch workflow lets the maintainer run integration tests against real AWS on-demand before any release, catching real API regressions before consumers hit them.

When LocalStack issue #13498 ships, Project A SHOULD revisit this decision and add a `docker-compose.yml`-based path matching Project B's pattern.

## 7. Security & supply-chain considerations

- **Provenance:** `v0.2.0` and later MUST publish with provenance. No unsigned publish path is acceptable.
- **Secrets:** the repository MUST NOT store a long-lived `NPM_TOKEN` once Trusted Publishing is configured. If the fallback path is used, `NPM_TOKEN` MUST be rotated after each use.
- **OIDC scope:** the CI workflow's `id-token: write` permission MUST be scoped to the `release` job only, not the whole workflow.
- **`npm audit` gate:** CI MUST fail on high/critical production-dependency vulnerabilities.
- **Dependency pinning:** all GitHub Actions MUST be pinned to major version tags (e.g., `@v6`); pinning to full SHAs MAY be adopted in a follow-up but is not required for this work.
- **IAM least privilege:** the README's IAM policy MUST NOT grant `s3vectors:*`; it MUST enumerate only the specific actions required by the class's methods.

## 8. Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| `aws-sdk-client-mock` incompatible with `S3VectorsClient` typing | Phase 2 partially blocked | Low | Spike-gate the migration; keep hand-rolled helper as fallback |
| Node 22 engine bump breaks downstream consumers on Node 20 | User-visible | Medium | 0.2.0 minor bump; CHANGELOG callout; Node 20 LTS maintenance already ending |
| TypeScript 6 strict-by-default surfaces latent typing issues | Phase 1 typecheck failures | Medium | Explicit `"types": ["node", "jest"]`; fix any surfaced issues in Phase 1 |
| Trusted Publishing misconfiguration at release time | `v0.2.0` publish fails | Low | Fallback to `--provenance` + `NPM_TOKEN` documented in §5.4.2 |
| Stryker run too slow on local hardware | Developer friction | Low | Incremental mode enabled; `test:mutate:quick` variant for partial runs |
| Phase 3 refactor introduces silent behavior change | Consumer regression | Medium | Untouched test suite modulo imports; manual live-AWS integration test run as final safety net; Stryker mutation coverage |
| Third-party action version drift between spec and implementation | Staleness | Medium | Implementer re-verifies every action pin before each workflow lands |

## 9. Phase dependencies & sequencing

```
Phase 1 commit  ──▶  Phase 2 commit  ──▶  Phase 3 commit  ──▶  Phase 4 commit  ──▶  push to main  ──▶  tag v0.2.0
   (hygiene + CI)    (test infra)         (src refactor)       (README + release)
```

All four commits land on the same working branch. Each phase MUST be locally verified against its acceptance criteria before the next phase is started. The branch is pushed to `main` (and CI runs) after Phase 4 is committed. The `v0.2.0` tag is pushed after the post-push CI passes and the Trusted Publisher is configured on npmjs.com.

The repository SHOULD NOT remain on an intermediate phase for longer than one calendar week to avoid drift from Project B's evolving baseline.

## 10. Implementation verification checklist

Before each phase's local commit is authored, the implementer MUST confirm:

- [ ] All GitHub Action versions referenced in the phase have been re-verified against their upstream release pages within the last 24 hours.
- [ ] All npm dev-dependency versions added/changed have been verified against the npm registry.
- [ ] The relevant phase's acceptance criteria in this spec are met locally.
- [ ] Local `npm run lint`, `typecheck`, `test`, `build` all pass.
- [ ] The commit message explicitly lists any deviation from this spec with justification.

Before the working branch is pushed to `main`:

- [ ] All four phase commits are present and in order.
- [ ] The full test suite (including `test:mutate`) passes locally end-to-end.
- [ ] The live-integration smoke test has been executed successfully at least once.

## 11. Rollback plan

All rollbacks prior to push-to-`main` are local-only: `git reset --hard HEAD~1` (or `HEAD~N` to drop multiple phase commits) on the working branch. No remote state is affected because phases are not pushed individually.

- **Phase 1 rollback (local):** drop the commit; repo returns to pre-alignment state with no data loss (additive only).
- **Phase 2 rollback (local):** drop the commit; unit tests continue to pass against the original helper.
- **Phase 3 rollback (local):** drop the commit; `src/` returns to monolithic layout; test import paths revert automatically.
- **Phase 4 rollback (local):** drop the commit; README and workflow changes are undone.
- **Post-push rollback:** if the working branch has already been pushed/merged to `main`, use `git revert <sha>` to create a reverting commit (preferred over `reset --hard` on a shared branch).
- **Post-release rollback:** if `v0.2.0` has already been published to npm, deprecate it (`npm deprecate @farukada/aws-langchain-s3-vector-ts@0.2.0 "<reason>"`) — npm publishes are not reversible.

## 12. Open questions deferred to implementation

- Final outcome of the `aws-sdk-client-mock` spike (proceed with migration or retain hand-rolled helper) — to be recorded in the Phase 2 commit message.
- Precise version pins for npm dev-dependency upgrades and GitHub Action pins — MUST be re-verified at each phase's implementation time per §10.

## 13. References

- Sibling project: `aws-langgraph-dynamodb-ts` (C:\Users\info\Documents\Projects\AI-Libs\aws-langgraph-dynamodb-ts)
- Python reference: [`langchain_aws.vectorstores.s3_vectors.base`](https://github.com/langchain-ai/langchain-aws/blob/main/libs/aws/langchain_aws/vectorstores/s3_vectors/base.py)
- [LocalStack `s3vectors` feature request #13498](https://github.com/localstack/localstack/issues/13498)
- [npm Trusted Publishing docs](https://docs.npmjs.com/trusted-publishers/)
- [npm Provenance docs](https://docs.npmjs.com/generating-provenance-statements/)
- [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock)
- [`softprops/action-gh-release`](https://github.com/softprops/action-gh-release/releases) (latest `@v3`)
- [`actions/checkout`](https://github.com/actions/checkout/releases) (latest `@v6`)
- [`actions/setup-node`](https://github.com/actions/setup-node/releases) (latest `@v6`)
