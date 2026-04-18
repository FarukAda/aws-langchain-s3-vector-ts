# Parity Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `@farukada/aws-langchain-s3-vector-ts` to enterprise-grade parity with `@farukada/aws-langgraph-dynamodb-ts` across tooling, testing, CI, hygiene, source organization, and documentation — culminating in a `v0.2.0` release published with npm Trusted Publishing and provenance attestations.

**Architecture:** Four sequenced local commits on a single working branch `feat/parity-alignment`. Phase 1 lands hygiene + CI skeleton. Phase 2 migrates test infrastructure (spike-gated `aws-sdk-client-mock` migration + live-AWS integration harness + Stryker mutation testing). Phase 3 decomposes `src/s3-vectors.ts` into a `shared/` directory of pure helpers without changing behavior. Phase 4 rewrites the README, authors the release workflow using OIDC Trusted Publishing, populates the CHANGELOG, and bumps to `0.2.0`. The branch is pushed to `main` only after all four phases are locally verified.

**Tech Stack:** TypeScript 6, Node.js 22.14+ (ESM), Jest 30 with `ts-jest`, `aws-sdk-client-mock` (pending spike), `@stryker-mutator/*` 9.6+, ESLint 10 (flat config in TypeScript), Prettier, TypeDoc, GitHub Actions, npm Trusted Publishing, `@aws-sdk/client-s3vectors`, `@langchain/core`.

**Reference spec:** `docs/superpowers/specs/2026-04-18-parity-alignment-design.md` (read this first if any task is ambiguous).

**Reference project:** `../aws-langgraph-dynamodb-ts/` — the sibling package to match in quality bar.

**Reference implementation for behavior:** Python `langchain_aws.vectorstores.s3_vectors.base.AmazonS3Vectors` at https://github.com/langchain-ai/langchain-aws/blob/main/libs/aws/langchain_aws/vectorstores/s3_vectors/base.py — DO NOT diverge behavior from this module.

---

## File Structure (what each phase touches)

### Phase 1 — Hygiene & CI skeleton
- **Create:** `.nvmrc`, `.gitattributes`, `.depcheckrc`, `.prettierignore`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `eslint.config.ts`, `.github/workflows/ci.yml`
- **Modify:** `tsconfig.json`, `package.json`, `.gitignore`
- **Delete:** `eslint.config.js`

### Phase 2 — Test infrastructure
- **Create:** `jest.integration.config.ts`, `stryker.conf.json`, `.github/workflows/integration-live.yml`, `test/integration/smoke.test.ts`, `test/integration/_guard.ts`, 11 split unit-test files under `test/`
- **Modify:** `test/helpers.ts` (after rename), `jest.config.ts`, `package.json` (scripts + devDeps)
- **Delete:** `tests/s3-vectors.test.ts`, `tests/helpers.ts` (after moving to `test/`)
- **Rename:** `tests/` → `test/`

### Phase 3 — src/ refactor
- **Create:** `src/shared/stub-embeddings.ts`, `src/shared/errors.ts`, `src/shared/metadata.ts`, `src/relevance-scores.ts`
- **Modify:** `src/s3-vectors.ts` (slimmed), `src/index.ts`, every `test/*.test.ts` (import paths only)
- **Delete:** `src/utils.ts` (replaced by `src/relevance-scores.ts`)

### Phase 4 — README + release
- **Create:** `.github/workflows/release.yml`
- **Modify:** `README.md` (full rewrite), `CHANGELOG.md` (populate [0.2.0]), `package.json` (version bump)
- **Delete:** old `.github/workflows/release.yml` if exists (Project A currently has one; replace it)

---

## Preflight: Create working branch

### Task 0: Create the working branch

**Files:** none

- [ ] **Step 1:** Confirm working tree is clean

Run:
```bash
git status
```
Expected: `nothing to commit, working tree clean` (other than the untracked `.claude/` and `.idea/` which are fine).

- [ ] **Step 2:** Create and checkout the feature branch

Run:
```bash
git checkout -b feat/parity-alignment
```
Expected: `Switched to a new branch 'feat/parity-alignment'`.

---

## Phase 1 — Hygiene & CI skeleton (commit #1)

### Task 1.1: Verify current GitHub Action versions

**Files:** none (research only)

- [ ] **Step 1:** Fetch the latest stable major for each action used in this plan

Open in a browser (or use WebFetch):
- `https://github.com/actions/checkout/releases` → confirm latest major (expected: `v6`)
- `https://github.com/actions/setup-node/releases` → confirm latest major (expected: `v6`)
- `https://github.com/softprops/action-gh-release/releases` → confirm latest major (expected: `v3`)
- `https://github.com/aws-actions/configure-aws-credentials/releases` → confirm latest major (expected: `v5` with floating `v5` tag)

- [ ] **Step 2:** Note any deviations

If any major tag is newer than what this plan assumes, use the newer one throughout the plan AND update `docs/superpowers/specs/2026-04-18-parity-alignment-design.md` references in the same phase's commit.

### Task 1.2: Create `.nvmrc`

**Files:**
- Create: `.nvmrc`

- [ ] **Step 1:** Write the file

```
22
```

Contents: exactly `22` followed by a single newline.

- [ ] **Step 2:** Verify

Run:
```bash
cat .nvmrc
```
Expected: `22`

### Task 1.3: Create `.gitattributes`

**Files:**
- Create: `.gitattributes`

- [ ] **Step 1:** Copy from Project B

Run:
```bash
cp ../aws-langgraph-dynamodb-ts/.gitattributes .gitattributes
```

- [ ] **Step 2:** Verify the file normalizes LF line endings

Run:
```bash
cat .gitattributes
```
Expected contents should include a `* text=auto eol=lf` directive (or equivalent). If Project B's file diverges from this, keep Project B's version for parity.

### Task 1.4: Create `.depcheckrc`

**Files:**
- Create: `.depcheckrc`

- [ ] **Step 1:** Copy from Project B as a starting point

Run:
```bash
cp ../aws-langgraph-dynamodb-ts/.depcheckrc .depcheckrc
```

- [ ] **Step 2:** Inspect and adjust ignores for Project A's dev dependencies

Read the copied file. Any ignore entry that references packages unique to Project B (e.g., `ts-loader`, `jiti` before Project A installs it) should be retained only if Project A will have that package after this phase.

Known devDeps Project A will have after Phase 1: `jiti` (new, for eslint.config.ts), `@types/node`, `@types/jest`. Retain ignore entries for these.

Remove any entry that mentions packages Project A will never install (e.g., langgraph-specific packages).

### Task 1.5: Create `.prettierignore`

**Files:**
- Create: `.prettierignore`

- [ ] **Step 1:** Copy from Project B

Run:
```bash
cp ../aws-langgraph-dynamodb-ts/.prettierignore .prettierignore
```

- [ ] **Step 2:** Verify the ignore list covers `node_modules`, `dist`, `coverage`, and `reports`

Read the file; if any are missing, add them.

### Task 1.6: Create `CODE_OF_CONDUCT.md`

**Files:**
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1:** Copy verbatim from Project B

Run:
```bash
cp ../aws-langgraph-dynamodb-ts/CODE_OF_CONDUCT.md CODE_OF_CONDUCT.md
```

- [ ] **Step 2:** Update any references to the sibling repo

Search for `aws-langgraph-dynamodb-ts` in the file. If present, replace with `aws-langchain-s3-vector-ts`. Search for the sibling's repo URL and replace with this repo's URL (`https://github.com/FarukAda/aws-langchain-s3-vector-ts`).

### Task 1.7: Create `CHANGELOG.md` skeleton

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1:** Write the file

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Removed

### Fixed

## [0.1.0] - 2025-03-22

- Initial release.
```

The date `2025-03-22` reflects the first-commit date in git history (see `git log --reverse --format=%ad --date=short | head -1`). If that output differs, use the actual earliest commit date.

### Task 1.8: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1:** Read current contents

Run:
```bash
cat .gitignore
```

- [ ] **Step 2:** Append Stryker and reports entries

Append these lines to `.gitignore` (deduplicate if already present):

```
# Stryker mutation testing
.stryker-incremental.json
.stryker-tmp/
reports/
```

### Task 1.9: Update `tsconfig.json` for TypeScript 6

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1:** Read current file

Run:
```bash
cat tsconfig.json
```

- [ ] **Step 2:** Replace with the TypeScript-6-ready version

Write these exact contents to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "coverage", "tests", "test"]
}
```

Note: `"types": ["node", "jest"]` is required in TypeScript 6 — `@types` directories are no longer auto-crawled.

- [ ] **Step 3:** Verify typecheck still passes (it will fail if upgrades are not yet done — that's OK at this step; we'll revisit after Task 1.12)

### Task 1.10: Upgrade package.json — engines, scripts, dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Read current file

Run:
```bash
cat package.json
```

- [ ] **Step 2:** Verify npm-registry versions BEFORE pinning anything in this step

Run the version lookup for each package you're about to modify:
```bash
npm view typescript version
npm view knip version
npm view jscpd version
npm view eslint-plugin-perfectionist version
npm view typescript-eslint version
npm view jiti version
```
Record each output. If any package version differs from what this plan specifies below, use the newer version in the edit.

- [ ] **Step 3:** Apply the package.json edits

Update these fields (keeping all other fields unchanged):

- `engines`:
  ```json
  "engines": {
    "node": ">=22.14.0",
    "npm": ">=10.0.0"
  }
  ```

- `scripts.lint`: change from `"eslint src/**/*.ts tests/**/*.ts --fix"` to `"eslint \"src/**/*.ts\" \"test/**/*.ts\""` (no `--fix`; quoted globs for cross-platform).

- `scripts["lint:fix"]`: new script, `"eslint \"src/**/*.ts\" \"test/**/*.ts\" --fix"` (insert after `lint`).

- `devDependencies` upgrades (use the exact version printed by `npm view` in Step 2; the caret range shown here is illustrative):
  - `typescript`: `^6.0.3`
  - `knip`: `^6.4.1` (or later)
  - `jscpd`: `^4.0.9` (or later)
  - `eslint-plugin-perfectionist`: `^5.8.0` (or later)
  - `typescript-eslint`: `^8.58.2` (or later)

- `devDependencies` additions:
  - `jiti`: `^2.6.1` (or latest from `npm view jiti version`)

- [ ] **Step 4:** Reinstall dependencies

Run:
```bash
npm install
```
Expected: completes without error. Note any peer-dependency warnings; if there's an ERR (not WARN), investigate before continuing.

- [ ] **Step 5:** Verify typecheck passes after upgrade

Run:
```bash
npm run typecheck
```
Expected: no errors. If TypeScript 6's stricter defaults flag new errors in `src/`, fix them — these are bugs Phase 1 exposes (document any non-trivial fix in the Phase 1 commit message).

### Task 1.11: Delete `eslint.config.js`, create `eslint.config.ts`

**Files:**
- Delete: `eslint.config.js`
- Create: `eslint.config.ts`

- [ ] **Step 1:** Copy Project B's TypeScript ESLint config

Run:
```bash
cp ../aws-langgraph-dynamodb-ts/eslint.config.ts eslint.config.ts
```

- [ ] **Step 2:** Adjust the config for Project A

Read the copied file. If it references a `test/` directory, that's correct. If it has any plugin imports Project A doesn't have installed, either install them (bias toward parity) or remove them.

- [ ] **Step 3:** Delete the old JavaScript config

Run:
```bash
rm eslint.config.js
```

- [ ] **Step 4:** Verify ESLint loads the `.ts` config via jiti

Run:
```bash
npm run lint
```
Expected: lint completes (pass or fail — if there are lint errors, fix them in this step before committing).

If ESLint can't find `jiti`, confirm it was installed in Task 1.10 Step 4.

### Task 1.12: Write the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1:** Write the workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    name: lint + typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22.14.0'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test:
    name: test (node ${{ matrix.node }} on ${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: ['22', '24']
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm test -- --ci
      - run: npm run build

  audit:
    name: npm audit (high+)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22.14.0'
          cache: npm
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
```

Note: no `pull_request` trigger. CI runs only on `push` to `main` and on manual `workflow_dispatch`.

- [ ] **Step 2:** Validate syntax locally with `actionlint`

If `actionlint` is installed:
```bash
actionlint .github/workflows/ci.yml
```
Expected: no output (success).

If `actionlint` is not installed, install it (`brew install actionlint` on macOS, or download from https://github.com/rhysd/actionlint/releases for Windows) OR skip and document the skip in the commit message.

### Task 1.13: Run the full Phase 1 local verification

**Files:** none (verification only)

- [ ] **Step 1:** Lint

Run:
```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 2:** Typecheck

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3:** Unit tests

Run:
```bash
npm test
```
Expected: all tests pass. (The existing `tests/s3-vectors.test.ts` still exists — Phase 1 does not touch tests.)

- [ ] **Step 4:** Build

Run:
```bash
npm run build
```
Expected: completes; `dist/` is populated.

- [ ] **Step 5:** Unused check

Run:
```bash
npm run unused
```
Expected: no unused items. If new entries appear after the TS 6 upgrade, fix them.

- [ ] **Step 6:** Depcheck

Run:
```bash
npm run depcheck
```
Expected: no errors.

### Task 1.14: Commit Phase 1

**Files:** none (git only)

- [ ] **Step 1:** Review staged diff

Run:
```bash
git add -A
git diff --cached --stat
```
Expected: shows only files listed in Phase 1's File Structure section above (new hygiene files, modified tsconfig/package.json/.gitignore, replaced eslint config, new ci.yml).

- [ ] **Step 2:** Commit

Run:
```bash
git commit -m "chore(phase-1): hygiene files, TS 6 upgrade, CI skeleton

- Adds .nvmrc, .gitattributes, .depcheckrc, .prettierignore,
  CODE_OF_CONDUCT.md, CHANGELOG.md skeleton.
- Upgrades TypeScript to 6.0 and tightens tsconfig
  (noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters,
  explicit types array required by TS 6).
- Converts eslint.config.js to eslint.config.ts loaded via jiti.
- Bumps Node engines to >=22.14.0 (required by npm Trusted Publishing).
- Adds .github/workflows/ci.yml: push-to-main triggered matrix across
  3 OS x Node 22/24, with lint, typecheck, test, build, audit jobs.
  Does NOT run on pull_request."
```

- [ ] **Step 3:** Confirm the commit and branch state

Run:
```bash
git log --oneline -3
git status
```
Expected: Phase 1 commit at HEAD; working tree clean; on `feat/parity-alignment`.

**Do NOT push.** The branch stays local until Phase 4 completes.

---

## Phase 2 — Test infrastructure (commit #2)

### Task 2.1: aws-sdk-client-mock spike (gated)

**Files:**
- Create (throwaway): `tests/_spike.test.ts`
- Modify: `package.json` (add `aws-sdk-client-mock` devDep)

- [ ] **Step 1:** Verify aws-sdk-client-mock version

Run:
```bash
npm view aws-sdk-client-mock version
```
Expected: `4.1.0` or later. Use that version in the next step.

- [ ] **Step 2:** Install the library

Run:
```bash
npm install --save-dev aws-sdk-client-mock
```

- [ ] **Step 3:** Write the spike test

Create `tests/_spike.test.ts`:

```typescript
import {
  S3VectorsClient,
  CreateIndexCommand,
  GetIndexCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';

describe('aws-sdk-client-mock S3VectorsClient compatibility spike', () => {
  const s3vMock = mockClient(S3VectorsClient);

  beforeEach(() => {
    s3vMock.reset();
  });

  it('resolves CreateIndexCommand', async () => {
    s3vMock.on(CreateIndexCommand).resolves({ indexArn: 'arn:spike' });

    const client = new S3VectorsClient({});
    const result = await client.send(
      new CreateIndexCommand({
        vectorBucketName: 'b',
        indexName: 'i',
        dataType: 'float32',
        dimension: 3,
        distanceMetric: 'cosine',
      }),
    );

    expect(result.indexArn).toBe('arn:spike');
    expect(s3vMock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('rejects GetIndexCommand with NotFoundException', async () => {
    const err = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    s3vMock.on(GetIndexCommand).rejects(err);

    const client = new S3VectorsClient({});
    await expect(
      client.send(new GetIndexCommand({ vectorBucketName: 'b', indexName: 'i' })),
    ).rejects.toMatchObject({ name: 'NotFoundException' });
  });
});
```

- [ ] **Step 4:** Run the spike

Run:
```bash
npm test -- _spike
```
Expected:
- **PASS** → spike succeeded; proceed to Task 2.2 onwards with the migration path.
- **FAIL** → spike failed. Record the failure output, delete `tests/_spike.test.ts`, remove `aws-sdk-client-mock` from devDependencies, and:
  - Write a feedback memory file at `C:\Users\info\.claude\projects\C--Users-info-Documents-Projects-AI-Libs-aws-langchain-s3-vector-ts\memory\feedback_aws_sdk_client_mock_failed.md` documenting the failure mode
  - Update the MEMORY.md index
  - Skip Task 2.2 and Task 2.3's helper rewrite; keep the current hand-rolled helper and adjust Task 2.4 to rename `tests/helpers.ts` → `test/helpers.ts` unchanged
  - Record the skip in the Phase 2 commit message

- [ ] **Step 5:** Clean up the spike file

Run:
```bash
rm tests/_spike.test.ts
```

### Task 2.2: Rewrite `tests/helpers.ts` to use `aws-sdk-client-mock`

**Skip this task if the Task 2.1 spike failed.**

**Files:**
- Modify: `tests/helpers.ts`

- [ ] **Step 1:** Replace `tests/helpers.ts` contents

Write these exact contents:

```typescript
import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { jest } from '@jest/globals';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

/**
 * Create a mocked `S3VectorsClient` using aws-sdk-client-mock.
 *
 * The returned `client` is a real `S3VectorsClient` instance whose `send`
 * method is intercepted by the returned `mock` stub. Use
 * `mock.on(CommandClass).resolves(...)` / `.rejects(...)` to script
 * responses, and `mock.commandCalls(CommandClass)` to assert invocations.
 *
 * Always call `mock.reset()` in `beforeEach` to avoid cross-test leakage.
 */
export function createMockClient(): {
  client: S3VectorsClient;
  mock: AwsClientStub<S3VectorsClient>;
} {
  const client = new S3VectorsClient({ region: 'us-east-1' });
  const mock = mockClient(client);
  return { client, mock };
}

/**
 * Create a mock `EmbeddingsInterface` that returns deterministic vectors.
 *
 * @param dimension Length of each vector returned.
 */
export function createMockEmbeddings(dimension = 3): EmbeddingsInterface {
  return {
    embedDocuments: jest.fn(async (docs: string[]) =>
      docs.map((_, i) => Array.from({ length: dimension }, (__, d) => i + d * 0.1)),
    ),
    embedQuery: jest.fn(async () => Array.from({ length: dimension }, (_, d) => 99 + d * 0.1)),
  } as unknown as EmbeddingsInterface;
}
```

The existing test file uses `mockSend` (a `jest.Mock`) — this is changing to `mock` (an `AwsClientStub`). Task 2.5 updates every call site.

### Task 2.3: Rename `tests/` → `test/` and split the test file

**Files:**
- Rename: `tests/` → `test/`
- Delete: `test/s3-vectors.test.ts` (after splitting)
- Create: 10 new files under `test/` (one per test suite)

- [ ] **Step 1:** Rename the directory

Run:
```bash
git mv tests test
```

- [ ] **Step 2:** Update `testMatch` and coverage config in `jest.config.ts`

Modify `jest.config.ts`:
- Change `testMatch` from `['**/*.test.ts']` to `['<rootDir>/test/**/*.test.ts']` and add `testPathIgnorePatterns: ['<rootDir>/test/integration/']`
- Change `coverageThreshold.global` to:
  ```js
  {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  }
  ```

Full new file:

```typescript
export default {
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  verbose: true,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 90000,
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  reporters: [
    'default',
    [
      'jest-sonar',
      {
        outputDirectory: 'coverage',
        outputName: 'test-report.xml',
        reportedFilePath: 'relative',
      },
    ],
  ],
};
```

- [ ] **Step 3:** Verify tests still run before splitting

Run:
```bash
npm test
```
Expected: all tests pass (possibly with helper-related type errors if Task 2.2 was done — fix those now).

- [ ] **Step 4:** Split the monolithic test into per-feature files

The existing `test/s3-vectors.test.ts` contains multiple `describe` blocks. Create one file per domain:

For each target file, create the file with:
- The original imports from `test/s3-vectors.test.ts` (adjust as needed for which commands each file uses)
- The corresponding `describe` block(s) from the original, unchanged except for helper-call-site updates (see Task 2.5)
- The shared `BASE_CONFIG` constant (duplicate it — per-file independence is more important than DRY for tests)

Target file mapping (describe blocks from the current `test/s3-vectors.test.ts`):

| New file | Contains these `describe` blocks |
|---|---|
| `test/relevance-scores.test.ts` | `"Relevance score functions"` |
| `test/constructor.test.ts` | `"AmazonS3Vectors constructor"` |
| `test/add-vectors.test.ts` | `"AmazonS3Vectors.addVectors"` |
| `test/add-documents.test.ts` | `"AmazonS3Vectors.addDocuments"`, `"AmazonS3Vectors.addDocuments per-batch embedding"` |
| `test/add-texts.test.ts` | `"AmazonS3Vectors.addTexts"` |
| `test/similarity-search.test.ts` | `"AmazonS3Vectors.similaritySearchVectorWithScore"`, `"AmazonS3Vectors.similaritySearchWithScore"`, `"AmazonS3Vectors.similaritySearchByVector"`, `"AmazonS3Vectors.*page_content handling"`, `"AmazonS3Vectors._selectRelevanceScoreFn"` |
| `test/delete.test.ts` | `"AmazonS3Vectors.delete"` |
| `test/get-by-ids.test.ts` | `"AmazonS3Vectors.getByIds"`, `"AmazonS3Vectors.getByIds with duplicate IDs"` |
| `test/auto-index.test.ts` | `"AmazonS3Vectors auto-index with nonFilterableMetadataKeys"` |
| `test/from-texts.test.ts` | `"AmazonS3Vectors.fromTexts"` |

- [ ] **Step 5:** Delete the monolithic test file

```bash
rm test/s3-vectors.test.ts
```

- [ ] **Step 6:** Run tests

```bash
npm test
```
Expected: all tests pass. Test count should equal (or be within a small delta of) the pre-split count. If any test fails, cross-check against the original monolithic file.

### Task 2.4: Update every call site to use the new mock API

**Skip this task if the Task 2.1 spike failed (no API change needed).**

**Files:**
- Modify: every file under `test/*.test.ts`

- [ ] **Step 1:** For each file from Task 2.3, change helper destructuring

Replace:
```typescript
const { client, mockSend } = createMockClient();
// ...
mockSend.mockResolvedValueOnce(X);
mockSend.mockResolvedValue(X);
mockSend.mockRejectedValueOnce(X);
expect(mockSend).toHaveBeenCalledTimes(N);
mockSend.mock.calls[i]![0]
```

With:
```typescript
const { client, mock } = createMockClient();
// ...
import { CreateIndexCommand, PutVectorsCommand, /* etc. */ } from '@aws-sdk/client-s3vectors';

mock.on(ExpectedCommand).resolvesOnce(X);     // or .resolves(X) for "forever"
mock.on(ExpectedCommand).rejectsOnce(X);

expect(mock.calls()).toHaveLength(N);
mock.call(i).args[0]                           // → the Command instance
```

**Mapping table** for common assertions:

| Old | New |
|---|---|
| `mockSend.mockResolvedValueOnce(r)` | `mock.on(Cmd).resolvesOnce(r)` where `Cmd` is the expected command for that call |
| `mockSend.mockRejectedValueOnce(e)` | `mock.on(Cmd).rejectsOnce(e)` |
| `mockSend.mockResolvedValue(r)` (not `Once`) | `mock.on(Cmd).resolves(r)` |
| `expect(mockSend).toHaveBeenCalledTimes(n)` | `expect(mock.calls()).toHaveLength(n)` |
| `mockSend.mock.calls[i]![0]` | `mock.call(i).args[0]` |
| `expect(mockSend.mock.calls[i]![0]).toBeInstanceOf(PutVectorsCommand)` | `expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(>=1)` — or keep the instance check via `mock.call(i).args[0] instanceof PutVectorsCommand` |

Because `aws-sdk-client-mock`'s `.on(Cmd).resolvesOnce` is command-type-scoped rather than call-index-scoped, sequences that previously relied on call order (e.g., "first GetIndex fails, then CreateIndex succeeds, then PutVectors succeeds") may need restructuring: set up each command's behavior independently before the action under test, then assert via `mock.commandCalls(Cmd)` counts per command type.

For the existing test `AmazonS3Vectors.addVectors > auto-creates index when it does not exist`:

Before:
```typescript
const notFoundError = new Error('Not found');
(notFoundError as unknown as { name: string }).name = 'NotFoundException';
mockSend.mockRejectedValueOnce(notFoundError);       // for GetIndexCommand
mockSend.mockResolvedValueOnce({ indexArn: 'arn:test' }); // for CreateIndexCommand
mockSend.mockResolvedValueOnce({});                  // for PutVectorsCommand

await store.addVectors(vectors, docs, { ids: ['id-1'] });

expect(mockSend).toHaveBeenCalledTimes(3);
const createCall = mockSend.mock.calls[1]![0]!;
expect(createCall).toBeInstanceOf(CreateIndexCommand);
expect(createCall.input.dimension).toBe(3);
```

After:
```typescript
const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
mock.on(GetIndexCommand).rejects(notFoundError);
mock.on(CreateIndexCommand).resolves({ indexArn: 'arn:test' });
mock.on(PutVectorsCommand).resolves({});

await store.addVectors(vectors, docs, { ids: ['id-1'] });

expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);

const createCall = mock.commandCalls(CreateIndexCommand)[0]!.args[0];
expect(createCall.input.dimension).toBe(3);
```

Apply the same pattern to every test file.

- [ ] **Step 2:** Run the full unit suite

```bash
npm test
```
Expected: all tests pass. If any fail, inspect the failure and correct the migration. Do not weaken assertions to make them pass — if an assertion can't be preserved, the migration is incomplete.

### Task 2.5: Install Stryker

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Verify latest Stryker version

Run:
```bash
npm view @stryker-mutator/core version
```
Expected: `9.6.1` or later. Use whichever version prints.

- [ ] **Step 2:** Install the three Stryker packages pinned to the same version

Run (substituting the exact version from Step 1):
```bash
npm install --save-dev @stryker-mutator/core@9.6.1 @stryker-mutator/jest-runner@9.6.1 @stryker-mutator/typescript-checker@9.6.1
```
(Use exact pins, no caret — Project B does this and it avoids Stryker incompatibilities across sub-packages.)

### Task 2.6: Create `stryker.conf.json`

**Files:**
- Create: `stryker.conf.json`

- [ ] **Step 1:** Write the file

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "_comment": "Mutation testing config. Run with `npm run test:mutate`. Stryker flips operators, negations, boundaries, etc. in src/ and runs the unit suite against each mutation — any mutation the tests fail to kill signals a weak assertion.",
  "packageManager": "npm",
  "testRunner": "jest",
  "jest": {
    "projectType": "custom",
    "configFile": "jest.config.ts",
    "enableFindRelatedTests": true
  },
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "reporters": ["progress", "clear-text", "html"],
  "htmlReporter": {
    "fileName": "reports/mutation/index.html"
  },
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/**/types.ts"
  ],
  "ignorePatterns": [
    "dist",
    "coverage",
    "docs",
    "node_modules",
    "reports",
    ".stryker-tmp"
  ],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  },
  "concurrency": 4,
  "timeoutMS": 60000,
  "disableTypeChecks": "{src,test}/**/*.{ts,tsx}",
  "incremental": true,
  "incrementalFile": ".stryker-incremental.json"
}
```

- [ ] **Step 2:** Add Stryker scripts to `package.json`

Insert into `scripts`:

```json
"test:mutate": "stryker run",
"test:mutate:quick": "stryker run --mutate src/utils.ts"
```

(In Phase 3, the `test:mutate:quick` glob updates to `src/shared/**/*.ts` when `utils.ts` is renamed and `shared/` is created.)

- [ ] **Step 3:** Run a quick mutation test to sanity-check configuration

Run:
```bash
npm run test:mutate:quick
```
Expected: completes (may take 2-5 minutes); reports a kill-ratio. Kill-ratio SHOULD be ≥60% — if below, investigate and improve the relevance-score tests. A result of exactly `0%` killed almost always means Stryker mis-configured — re-check `jest.configFile` path and `mutate` globs.

### Task 2.7: Create the integration test harness

**Files:**
- Create: `jest.integration.config.ts`
- Create: `test/integration/_guard.ts`
- Create: `test/integration/smoke.test.ts`
- Modify: `package.json` (add `test:integration` script)

- [ ] **Step 1:** Create `jest.integration.config.ts`

```typescript
/**
 * Integration test runner. These tests talk to a real AWS S3 Vectors
 * bucket. They are intentionally kept out of the default `npm test` run
 * and are off by default — see test/integration/_guard.ts for the env
 * gating contract.
 *
 * To run locally:
 *   export RUN_LIVE_INTEGRATION=1
 *   export AWS_VECTOR_BUCKET=<your-vector-bucket>
 *   export AWS_REGION=us-east-1
 *   npm run test:integration
 *
 * LocalStack does NOT support s3vectors (see
 * https://github.com/localstack/localstack/issues/13498), so these
 * tests require a real AWS account with a pre-created S3 vector bucket.
 */
export default {
  testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 120000,
  clearMocks: true,
  collectCoverage: false,
  maxWorkers: 1,
  verbose: true,
};
```

- [ ] **Step 2:** Create the env guard

`test/integration/_guard.ts`:

```typescript
/**
 * Env-gated guard for live-AWS integration tests.
 *
 * Integration tests MUST import and invoke this at the top of their
 * test file. If the guard returns `false`, the test file MUST `return`
 * early (Jest will report zero tests in the file, which is the
 * intended behavior — no false pass, no false fail).
 */
export interface LiveIntegrationEnv {
  readonly bucketName: string;
  readonly region: string;
}

export function requireLiveIntegrationEnv(): LiveIntegrationEnv | null {
  if (process.env.RUN_LIVE_INTEGRATION !== '1') {
    // eslint-disable-next-line no-console
    console.log(
      '[integration] Skipped: set RUN_LIVE_INTEGRATION=1 to run live-AWS integration tests.',
    );
    return null;
  }

  const bucketName = process.env.AWS_VECTOR_BUCKET;
  if (!bucketName) {
    // eslint-disable-next-line no-console
    console.log(
      '[integration] Skipped: set AWS_VECTOR_BUCKET=<bucket> alongside RUN_LIVE_INTEGRATION=1.',
    );
    return null;
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  return { bucketName, region };
}
```

- [ ] **Step 3:** Create the smoke integration test

`test/integration/smoke.test.ts`:

```typescript
import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

// If env is not configured, exit the file early — Jest reports no tests
// for this file, which is the desired skipped state.
if (!env) {
  // eslint-disable-next-line jest/no-focused-tests, jest/no-disabled-tests
  describe.skip('live AWS S3 Vectors smoke (skipped)', () => {
    it('skipped', () => undefined);
  });
} else {
  describe('live AWS S3 Vectors smoke', () => {
    const indexName = `smoke-${randomUUID().slice(0, 8)}`;
    let store: AmazonS3Vectors;

    beforeAll(() => {
      store = new AmazonS3Vectors(
        {
          embedDocuments: async (docs: string[]) =>
            docs.map(() => Array.from({ length: 4 }, () => Math.random())),
          embedQuery: async () => Array.from({ length: 4 }, () => Math.random()),
        },
        {
          vectorBucketName: env.bucketName,
          indexName,
          region: env.region,
          distanceMetric: 'cosine',
        },
      );
    });

    afterAll(async () => {
      try {
        await store.delete();
      } catch {
        // Best-effort teardown; the test framework will surface any real issue
        // through the main assertions.
      }
    });

    it('creates index on first write, stores and queries a document', async () => {
      const ids = await store.addDocuments(
        [new Document({ pageContent: 'hello world', metadata: { genre: 'test' } })],
        { ids: ['doc-1'] },
      );
      expect(ids).toEqual(['doc-1']);

      const results = await store.similaritySearchWithScore('hello', 1);
      expect(results).toHaveLength(1);
      expect(results[0]![0].id).toBe('doc-1');
      expect(results[0]![0].metadata).toMatchObject({ genre: 'test' });
    }, 60_000);
  });
}
```

- [ ] **Step 4:** Add the integration script to `package.json`

Insert into `scripts`:

```json
"test:integration": "node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.integration.config.ts"
```

- [ ] **Step 5:** Verify the skip path works

Run (without the env vars set):
```bash
npm run test:integration
```
Expected: prints the skip message from `_guard.ts`, exits `0`.

- [ ] **Step 6:** Run the smoke test against a real AWS bucket

This step requires a pre-created S3 vector bucket that the author controls. Export the env vars (adjust values):

```bash
export RUN_LIVE_INTEGRATION=1
export AWS_VECTOR_BUCKET=<your-vector-bucket-name>
export AWS_REGION=us-east-1
# AWS credentials via AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
npm run test:integration
```

Expected: the smoke test passes (creates an index, stores a doc, queries it, deletes the index).

If the test fails, inspect the error:
- IAM permission denied → update the bucket's IAM policy to grant the actions listed in §7 of the spec
- Bucket not found → confirm `AWS_VECTOR_BUCKET` and `AWS_REGION` match an actual pre-created bucket
- Any other error → investigate; do NOT proceed to commit Phase 2 until this passes at least once

Save the successful run's log (even a screenshot) — referenced in the commit message.

### Task 2.8: Create the live-integration CI workflow

**Files:**
- Create: `.github/workflows/integration-live.yml`

- [ ] **Step 1:** Verify `aws-actions/configure-aws-credentials` latest version

Open https://github.com/aws-actions/configure-aws-credentials/releases. Note the latest major tag (expected: `v5`).

- [ ] **Step 2:** Write the workflow (substitute the verified version)

```yaml
name: Integration (live AWS)

on:
  workflow_dispatch:
    inputs:
      aws-region:
        description: 'AWS region for the test bucket'
        required: false
        default: 'us-east-1'

permissions:
  contents: read
  id-token: write

jobs:
  integration:
    name: live-aws integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22.14.0'
          cache: npm
      - run: npm ci
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: ${{ inputs.aws-region }}
      - run: npm run test:integration
        env:
          RUN_LIVE_INTEGRATION: '1'
          AWS_VECTOR_BUCKET: ${{ vars.AWS_VECTOR_BUCKET }}
          AWS_REGION: ${{ inputs.aws-region }}
```

- [ ] **Step 3:** Validate with actionlint if available

```bash
actionlint .github/workflows/integration-live.yml
```
Expected: no output.

### Task 2.9: Run the full Phase 2 local verification

**Files:** none (verification only)

- [ ] **Step 1:** Lint

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 2:** Typecheck

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3:** Unit tests + coverage

```bash
npm test
```
Expected: all tests pass; coverage ≥80/80/80/80.

- [ ] **Step 4:** Build

```bash
npm run build
```
Expected: completes.

- [ ] **Step 5:** Mutation tests (quick)

```bash
npm run test:mutate:quick
```
Expected: completes with kill-ratio ≥60%. (A full `npm run test:mutate` run is optional at this phase; it is slower and will be exercised in Phase 3 anyway.)

- [ ] **Step 6:** Integration (skip path)

```bash
unset RUN_LIVE_INTEGRATION
npm run test:integration
```
Expected: skip message, exit 0.

### Task 2.10: Commit Phase 2

**Files:** none (git only)

- [ ] **Step 1:** Review staged diff

```bash
git add -A
git diff --cached --stat
```

Expected: shows the renamed `test/` directory, the split test files, updated `jest.config.ts`, new `jest.integration.config.ts`, new `stryker.conf.json`, new `test/integration/` files, new `.github/workflows/integration-live.yml`, and `package.json` script/devDep additions.

- [ ] **Step 2:** Commit

```bash
git commit -m "test(phase-2): migrate to aws-sdk-client-mock, add integration + mutation testing

- Migrates unit test helpers from hand-rolled mock to aws-sdk-client-mock
  (verified compatibility with S3VectorsClient via spike before migration).
- Renames tests/ to test/ and splits the monolithic s3-vectors.test.ts
  into 10 feature-scoped files.
- Raises coverage thresholds to 80/80/80/80.
- Adds jest.integration.config.ts and test/integration/ harness with env
  gating (RUN_LIVE_INTEGRATION=1 + AWS_VECTOR_BUCKET). Verified locally
  against a real AWS bucket.
- Adds Stryker mutation testing (@stryker-mutator/core 9.6.x) with
  80/60/50 thresholds; test:mutate and test:mutate:quick scripts.
- Adds .github/workflows/integration-live.yml for on-demand live-AWS
  runs via GitHub OIDC.

LocalStack does not support s3vectors (localstack/localstack#13498) —
integration coverage is via live AWS only."
```

If the Task 2.1 spike failed, amend the commit body to document the failure and the retained hand-rolled helper.

- [ ] **Step 3:** Verify state

```bash
git log --oneline -3
git status
```
Expected: Phase 2 at HEAD, working tree clean, Phase 1 below it.

**Do NOT push.**

---

## Phase 3 — src/ modular refactor (commit #3)

### Task 3.1: Rename `src/utils.ts` → `src/relevance-scores.ts`

**Files:**
- Rename: `src/utils.ts` → `src/relevance-scores.ts`

- [ ] **Step 1:** Rename via git

```bash
git mv src/utils.ts src/relevance-scores.ts
```

- [ ] **Step 2:** Update imports in `src/s3-vectors.ts`

Change:
```typescript
import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './utils.js';
```
to:
```typescript
import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
```

- [ ] **Step 3:** Update `src/index.ts`

Change:
```typescript
export { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './utils.js';
```
to:
```typescript
export { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
```

- [ ] **Step 4:** Update imports in `test/relevance-scores.test.ts` and any other test file that imports from `../src/utils.js`

Change imports from `../src/utils.js` to `../src/relevance-scores.js`.

- [ ] **Step 5:** Update `stryker.conf.json`'s `test:mutate:quick` script (in `package.json`)

Change `"test:mutate:quick": "stryker run --mutate src/utils.ts"` to:
```json
"test:mutate:quick": "stryker run --mutate src/shared/**/*.ts"
```
(`shared/` will exist after Task 3.4.)

- [ ] **Step 6:** Run tests

```bash
npm test
```
Expected: all tests pass.

### Task 3.2: Create `src/shared/stub-embeddings.ts`

**Files:**
- Create: `src/shared/stub-embeddings.ts`

- [ ] **Step 1:** Write the file

```typescript
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

/** Symbol used to identify StubEmbeddings without instanceof. */
export const STUB_BRAND = Symbol('StubEmbeddings');

/**
 * Minimal no-op embeddings used as a placeholder when the caller does not
 * provide an embedding model (e.g. raw-vector-only workflows).
 * @internal
 */
export class StubEmbeddings implements EmbeddingsInterface {
  readonly [STUB_BRAND] = true;

  async embedDocuments(_documents: string[]): Promise<number[][]> {
    throw new Error('No embedding model configured');
  }
  async embedQuery(_query: string): Promise<number[]> {
    throw new Error('No embedding model configured');
  }
}

/** Type guard for StubEmbeddings that avoids instanceof. */
export function isStubEmbeddings(emb: unknown): boolean {
  return (
    typeof emb === 'object' && emb !== null && (emb as Record<symbol, boolean>)[STUB_BRAND] === true
  );
}
```

These declarations are moved verbatim from the current `src/s3-vectors.ts` (lines 605-629) — do not modify behavior.

### Task 3.3: Create `src/shared/errors.ts`

**Files:**
- Create: `src/shared/errors.ts`

- [ ] **Step 1:** Write the file

```typescript
/** Type guard for AWS SDK NotFoundException-shaped errors. */
export function isAwsNotFoundException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}
```

Moved verbatim from the current `src/s3-vectors.ts` (lines 598-603).

### Task 3.4: Create `src/shared/metadata.ts`

**Files:**
- Create: `src/shared/metadata.ts`

- [ ] **Step 1:** Write the file

```typescript
import { Document } from '@langchain/core/documents';

import type { S3OutputVector } from '../types.js';

/**
 * Build the metadata object to send alongside a PutVectors call.
 *
 * Pure function extracted from AmazonS3Vectors. Takes pageContentMetadataKey
 * explicitly to keep the helper free of class state.
 */
export function buildPutMetadata(
  doc: Document,
  pageContentMetadataKey: string | null,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...doc.metadata };

  if (pageContentMetadataKey !== null) {
    metadata[pageContentMetadataKey] = doc.pageContent;
  }

  return metadata;
}

/**
 * Reconstruct a LangChain `Document` from an S3 vector response.
 *
 * @param vector - The raw S3 output vector.
 * @param pageContentMetadataKey - The key under which pageContent is stored
 *        in metadata, or `null` if pageContent is not round-tripped.
 * @param deepCopyMetadata - When `true`, the returned metadata is deep-cloned
 *        via structuredClone, preventing shared-reference mutations between
 *        documents that originate from the same vector (duplicate-id case).
 */
export function createDocument(
  vector: S3OutputVector,
  pageContentMetadataKey: string | null,
  deepCopyMetadata = false,
): Document {
  let pageContent = '';
  const rawMeta = vector.metadata ?? {};
  const metadata: Record<string, unknown> = deepCopyMetadata
    ? structuredClone(rawMeta)
    : { ...rawMeta };

  if (pageContentMetadataKey !== null && pageContentMetadataKey in metadata) {
    const rawValue = metadata[pageContentMetadataKey];
    pageContent = typeof rawValue === 'string' ? rawValue : '';

    delete metadata[pageContentMetadataKey];
  }

  return new Document({ pageContent, id: vector.key, metadata });
}
```

These functions take `pageContentMetadataKey` as a parameter instead of reading it from `this` — that's the only signature change. Body logic is identical to the current `_buildPutMetadata` and `_createDocument` methods in `src/s3-vectors.ts` (lines 566-593).

### Task 3.5: Slim down `src/s3-vectors.ts`

**Files:**
- Modify: `src/s3-vectors.ts`

- [ ] **Step 1:** Add the new imports at the top

After the existing imports, add:

```typescript
import { isAwsNotFoundException } from './shared/errors.js';
import { buildPutMetadata, createDocument } from './shared/metadata.js';
import { StubEmbeddings, isStubEmbeddings } from './shared/stub-embeddings.js';
```

- [ ] **Step 2:** Remove the inlined declarations at the bottom of the file

Delete these sections from `src/s3-vectors.ts`:
- The `// ─── Helpers ───` comment block and the `isAwsNotFoundException` function
- The `STUB_BRAND` symbol, `isStubEmbeddings` function, and `StubEmbeddings` class

These all live in `src/shared/*.ts` now.

- [ ] **Step 3:** Delete the private methods that became pure functions

Delete these methods from the `AmazonS3Vectors` class:
- `_buildPutMetadata` (private method)
- `_createDocument` (private method)

- [ ] **Step 4:** Update the call sites inside the class to use the pure functions

In `_ensureIndexAndPut`:
```typescript
const metadata = this._buildPutMetadata(doc);
```
becomes:
```typescript
const metadata = buildPutMetadata(doc, this.pageContentMetadataKey);
```

In `similaritySearchVectorWithScore`, `similaritySearchByVector`, and `getByIds`:
```typescript
this._createDocument(v)
this._createDocument(v, hasDuplicateIds)
```
become:
```typescript
createDocument(v, this.pageContentMetadataKey)
createDocument(v, this.pageContentMetadataKey, hasDuplicateIds)
```

- [ ] **Step 5:** Verify the file compiles

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6:** Verify file length

```bash
wc -l src/s3-vectors.ts
```
Expected: under 500 lines (per spec §5.3.4 acceptance criterion).

### Task 3.6: Verify `src/index.ts` re-exports are unchanged from 0.1.0's public surface

**Files:**
- Modify (if needed): `src/index.ts`

- [ ] **Step 1:** Read the file

```bash
cat src/index.ts
```

- [ ] **Step 2:** Confirm these exports exist (and only these)

The public API is:

```typescript
export { AmazonS3Vectors } from './s3-vectors.js';

export type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  VectorDataType,
  S3VectorsDeleteParams,
  S3OutputVector,
} from './types.js';

export { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
```

The `StubEmbeddings`, `isAwsNotFoundException`, and metadata helpers are **internal** — they MUST NOT be re-exported from `src/index.ts`. If any of them leak through, remove the export.

### Task 3.7: Run the full Phase 3 local verification

**Files:** none (verification only)

- [ ] **Step 1:** Lint

```bash
npm run lint
```

- [ ] **Step 2:** Typecheck

```bash
npm run typecheck
```

- [ ] **Step 3:** Unit tests

```bash
npm test
```
Expected: all tests pass (no test file should have required logic changes — only import-path updates for `utils.js` → `relevance-scores.js`).

- [ ] **Step 4:** Build

```bash
npm run build
```

- [ ] **Step 5:** Public-API symbol check

Run:
```bash
node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort()))"
```
Expected output (exact set):
```
[
  'AmazonS3Vectors',
  'cosineRelevanceScoreFn',
  'euclideanRelevanceScoreFn'
]
```
(Type-only exports do not appear at runtime; that is correct.)

- [ ] **Step 6:** Mutation test quick run

```bash
npm run test:mutate:quick
```
Expected: completes; kill-ratio ≥60%. (`shared/**/*.ts` now exists.)

- [ ] **Step 7:** Diff check — test files changed only imports

Run:
```bash
git diff --stat test/
```
Expected: each modified `test/*.test.ts` shows a small diff (1-2 changed lines per file for the `utils.js` → `relevance-scores.js` import update). No test body changes.

### Task 3.8: Commit Phase 3

**Files:** none (git only)

- [ ] **Step 1:** Stage and review

```bash
git add -A
git diff --cached --stat
```
Expected: new `src/shared/*.ts` files, renamed `src/utils.ts` → `src/relevance-scores.ts`, slimmed `src/s3-vectors.ts`, import-path updates in tests and `src/index.ts`.

- [ ] **Step 2:** Commit

```bash
git commit -m "refactor(phase-3): decompose src into shared helpers

Extracts the following from src/s3-vectors.ts into src/shared/:
- stub-embeddings.ts (StubEmbeddings class, STUB_BRAND, isStubEmbeddings)
- errors.ts (isAwsNotFoundException type guard)
- metadata.ts (buildPutMetadata, createDocument as pure functions taking
  pageContentMetadataKey as an explicit parameter)

Renames src/utils.ts to src/relevance-scores.ts for semantic clarity.

Zero behavior change: public API (src/index.ts exports) is identical,
test assertions unchanged, only import paths updated. Python reference
implementation (langchain_aws.vectorstores.s3_vectors.base) keeps the
core class cohesive — this refactor does the same, extracting only
orthogonal helpers."
```

- [ ] **Step 3:** Verify state

```bash
git log --oneline -4
git status
```

**Do NOT push.**

---

## Phase 4 — README, release automation, v0.2.0 (commit #4)

### Task 4.1: Populate CHANGELOG.md `[0.2.0]` entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Replace the `[Unreleased]` placeholder

In `CHANGELOG.md`, replace the `## [Unreleased]` block with:

```markdown
## [Unreleased]

## [0.2.0] - 2026-04-18

### Added
- Integration test infrastructure (`jest.integration.config.ts`, `test/integration/`) with env-gated live-AWS runs (`RUN_LIVE_INTEGRATION=1`, `AWS_VECTOR_BUCKET`).
- On-demand live-AWS CI workflow `.github/workflows/integration-live.yml` using GitHub OIDC.
- Stryker mutation testing (`stryker.conf.json`, `test:mutate`, `test:mutate:quick`).
- CI workflow `.github/workflows/ci.yml` on push to main: matrix of 3 OS × Node 22/24 with lint, typecheck, test, build, and `npm audit` jobs.
- OIDC-based npm publishing with provenance attestations via Trusted Publishing (`release.yml`).
- `CODE_OF_CONDUCT.md` (Contributor Covenant).
- `CHANGELOG.md`, `.nvmrc`, `.gitattributes`, `.depcheckrc`, `.prettierignore`.
- `src/shared/` module with extracted internal helpers (`stub-embeddings`, `errors`, `metadata`).

### Changed
- **BREAKING:** Node engines raised from `>=20` to `>=22.14.0`. Node 22.14 is required by npm Trusted Publishing.
- Upgraded TypeScript to 6.0 with stricter `tsconfig.json` (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, explicit `types` array).
- Converted `eslint.config.js` to `eslint.config.ts` loaded via `jiti`.
- Renamed test directory `tests/` → `test/`; split monolithic test file into 10 feature-scoped files.
- Raised unit-test coverage thresholds from 75/80/80 to 80/80/80/80.
- Decomposed `src/s3-vectors.ts`: extracted internal helpers to `src/shared/` and renamed `src/utils.ts` → `src/relevance-scores.ts`. **Public API unchanged.**

### Removed
- Hand-rolled mock client in `tests/helpers.ts`, replaced by `aws-sdk-client-mock` (only if the compatibility spike succeeded — see commit message of Phase 2).

### Fixed
- None (Phase 3 is no-behavior-change).
```

If the Task 2.1 spike failed, remove the "Removed" entry.

### Task 4.2: Create the release workflow

**Files:**
- Modify: `.github/workflows/release.yml` (replacing existing)

- [ ] **Step 1:** Replace the existing release workflow

Overwrite `.github/workflows/release.yml` with:

```yaml
name: Release NPM Package

on:
  push:
    tags: ['v*']
  workflow_dispatch:

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

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
          cache: npm
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

Notes:
- No `--provenance` flag on `npm publish`: Trusted Publishing generates the attestation automatically.
- No `NODE_AUTH_TOKEN` env: Trusted Publishing uses short-lived OIDC credentials.
- `id-token: write` permission is required for Trusted Publishing.

- [ ] **Step 2:** Validate syntax

```bash
actionlint .github/workflows/release.yml
```
Expected: no output.

### Task 4.3: Rewrite the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Write the new README

The README MUST match Project B's depth (~600+ lines). Model its structure on `../aws-langgraph-dynamodb-ts/README.md`. Required sections in order:

1. **Header + badges**
   - npm version: `https://img.shields.io/npm/v/@farukada/aws-langchain-s3-vector-ts?color=cb3837`
   - CI status: `https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions/workflows/ci.yml/badge.svg`
   - Node: `https://img.shields.io/badge/node-%3E%3D22.14-green`
   - TypeScript: `https://img.shields.io/badge/typescript-6.0-blue`
   - License: `https://img.shields.io/npm/l/@farukada/aws-langchain-s3-vector-ts`
   - AWS SDK: `https://img.shields.io/badge/AWS%20SDK-v3-orange`
   - Sponsor (if applicable)

2. **Features** — retain and tighten the current list.

3. **Architecture** — short narrative + ASCII diagram showing data flow:
   ```
   Your code → AmazonS3Vectors → @aws-sdk/client-s3vectors → AWS S3 Vectors
                    │
                    ├─ batches PutVectors in groups of 200 (configurable)
                    ├─ auto-creates index on first write (configurable)
                    └─ extracts page_content from metadata key on reads
   ```
   Describe the `pageContentMetadataKey` convention.

4. **Quick Start** — minimal working example with `@langchain/aws`'s `BedrockEmbeddings`.

5. **Usage Examples** — retain current examples; add:
   - Raw-vector-only workflow (no embeddings model)
   - Separate query embeddings (`queryEmbeddings`)
   - Custom relevance score function

6. **Infrastructure & IAM** — required IAM policy JSON. Enumerate (no wildcards):
   - `s3vectors:CreateIndex`
   - `s3vectors:DeleteIndex`
   - `s3vectors:GetIndex`
   - `s3vectors:PutVectors`
   - `s3vectors:GetVectors`
   - `s3vectors:QueryVectors`
   - `s3vectors:DeleteVectors`

   Note the bucket must be pre-created manually (console or AWS CLI).

7. **Testing** — new section; MUST include:

   ```markdown
   ### Unit tests

   `npm test` — runs the full unit suite against mocked AWS SDK clients
   (`aws-sdk-client-mock`). Coverage threshold: 80/80/80/80.

   ### Mutation tests

   `npm run test:mutate` — runs Stryker over `src/`. Quick variant that
   mutates only `src/shared/`:
   `npm run test:mutate:quick`.

   ### Integration tests (live AWS)

   **LocalStack does not support `s3vectors`**
   ([localstack/localstack#13498](https://github.com/localstack/localstack/issues/13498)),
   so integration tests run against a real AWS S3 vector bucket. They are
   gated off by default and must be opted into explicitly.

   **Local run:**
   ```bash
   export RUN_LIVE_INTEGRATION=1
   export AWS_VECTOR_BUCKET=<your-vector-bucket>
   export AWS_REGION=us-east-1
   # Plus AWS credentials (AWS_PROFILE or explicit keys)
   npm run test:integration
   ```

   Without `RUN_LIVE_INTEGRATION=1` or `AWS_VECTOR_BUCKET` set, the suite
   prints a skip message and exits 0.

   **CI run (on-demand):** the `Integration (live AWS)` workflow in
   `.github/workflows/integration-live.yml` runs via `workflow_dispatch`
   using GitHub OIDC to assume an IAM role (`AWS_ROLE_TO_ASSUME` secret)
   and a pre-created bucket (`AWS_VECTOR_BUCKET` variable).
   ```

8. **Configuration** — cross-link to TypeDoc-generated `docs/interfaces/AmazonS3VectorsConfig.html`.

9. **Project structure** — reflect Phase 3's `src/` tree:
   ```
   src/
   ├── index.ts                 (public barrel)
   ├── s3-vectors.ts            (AmazonS3Vectors class)
   ├── relevance-scores.ts      (cosine / euclidean score fns)
   ├── types.ts                 (config + output types)
   └── shared/                  (internal helpers)
       ├── stub-embeddings.ts
       ├── errors.ts
       └── metadata.ts
   ```

10. **API Reference** — "See [TypeDoc output](./docs/) for complete API reference" with a link to the `docs/classes/AmazonS3Vectors.html` landing page.

11. **Contributing** — brief section pointing to `CODE_OF_CONDUCT.md`. Include the local development commands: clone, `nvm use`, `npm ci`, `npm test`.

12. **License** — retain the current MIT line.

- [ ] **Step 2:** Preview locally

Use a Markdown preview tool (VS Code's built-in preview, `grip`, etc.) to verify headings, badges, TOC links, and code blocks render correctly.

- [ ] **Step 3:** Verify the line count

```bash
wc -l README.md
```
Expected: ≥600 lines (matching Project B's depth).

### Task 4.4: Bump version to 0.2.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Update the version

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 2:** Regenerate lockfile metadata

Run:
```bash
npm install
```
Expected: updates the top-level package entry in `package-lock.json`.

### Task 4.5: Run full local verification before committing Phase 4

**Files:** none (verification only)

- [ ] **Step 1:** Lint, typecheck, test, build, audit

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm audit --omit=dev --audit-level=high
```
Expected: every command succeeds.

- [ ] **Step 2:** Full mutation run (optional but recommended before release)

```bash
npm run test:mutate
```
Expected: completes; kill-ratio ≥60%. High is 80%; aim for high but accept ≥60%.

- [ ] **Step 3:** Confirm `package.json` is valid

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)"
```
Expected: `0.2.0`.

### Task 4.6: Commit Phase 4

**Files:** none (git only)

- [ ] **Step 1:** Stage and review

```bash
git add -A
git diff --cached --stat
```
Expected: `README.md` (large diff — full rewrite), `CHANGELOG.md` (populated [0.2.0]), `.github/workflows/release.yml` (replaced), `package.json` (version bump + lockfile).

- [ ] **Step 2:** Commit

```bash
git commit -m "release(phase-4): rewrite README, OIDC release workflow, v0.2.0

- Rewrites README to match aws-langgraph-dynamodb-ts depth (~600 lines):
  architecture, IAM policy, testing section (incl. live-AWS integration
  instructions and explicit LocalStack-unsupported note), project
  structure, contributing.
- Replaces release.yml with an OIDC Trusted Publishing workflow that
  publishes to npm with automatic provenance attestation (no NPM_TOKEN,
  no --provenance flag needed).
- Populates CHANGELOG.md [0.2.0] entry.
- Bumps package version 0.1.0 → 0.2.0.

Before pushing the v0.2.0 tag, a Trusted Publisher MUST be configured on
npmjs.com for this package (Settings → Trusted Publishers → GitHub
Actions → FarukAda / aws-langchain-s3-vector-ts / release.yml)."
```

- [ ] **Step 3:** Verify state

```bash
git log --oneline -5
git status
```
Expected: four phase commits at HEAD; working tree clean.

**Do NOT push yet.** Next task is the push-and-release sequence.

---

## Push + Release Sequence (after all four phases committed)

### Task 5.1: Final pre-push verification

**Files:** none (verification only)

- [ ] **Step 1:** Confirm all four phase commits are present and in order

```bash
git log --oneline -5
```
Expected (youngest first):
```
<hash> release(phase-4): rewrite README, OIDC release workflow, v0.2.0
<hash> refactor(phase-3): decompose src into shared helpers
<hash> test(phase-2): migrate to aws-sdk-client-mock, add integration + mutation testing
<hash> chore(phase-1): hygiene files, TS 6 upgrade, CI skeleton
<hash> <earlier commits (main)>
```

- [ ] **Step 2:** Run end-to-end verification

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm audit --omit=dev --audit-level=high && npm run test:mutate:quick
```
Expected: every command succeeds.

- [ ] **Step 3:** Re-run the live-AWS smoke test

Ensure the integration smoke test still passes end-to-end:
```bash
export RUN_LIVE_INTEGRATION=1
export AWS_VECTOR_BUCKET=<your-bucket>
export AWS_REGION=us-east-1
npm run test:integration
```
Expected: passes.

### Task 5.2: Configure Trusted Publisher on npmjs.com

**Files:** none (external configuration)

- [ ] **Step 1:** Sign in to npmjs.com as the package owner

- [ ] **Step 2:** Navigate to the package settings

URL: `https://www.npmjs.com/package/@farukada/aws-langchain-s3-vector-ts/access`

- [ ] **Step 3:** Add a GitHub Actions Trusted Publisher

Settings → Trusted Publishers → Add → GitHub Actions. Enter:
- Organization or user: `FarukAda`
- Repository: `aws-langchain-s3-vector-ts`
- Workflow filename: `release.yml`
- Environment name: (leave empty)

Save.

### Task 5.3: Push the working branch and run CI

**Files:** none (git only)

- [ ] **Step 1:** Push the branch (or merge into main, depending on workflow preference)

If merging into main directly:
```bash
git checkout main
git merge --ff-only feat/parity-alignment
git push origin main
```

If pushing the branch first (to run CI before merging):
```bash
git push origin feat/parity-alignment
```
Then open and merge via GitHub UI. (Recall: CI does NOT run on pull_request, so opening a PR will not trigger CI — CI only runs after merge to `main`.)

- [ ] **Step 2:** Watch the CI workflow on GitHub

Go to https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions.

Expected: the `CI` workflow run (triggered by the push to `main`) passes every job in the matrix.

If CI fails, investigate and fix on a follow-up branch. Do NOT tag `v0.2.0` until CI is green.

### Task 5.4: Tag and publish v0.2.0

**Files:** none (git tag only)

- [ ] **Step 1:** Ensure local `main` matches remote

```bash
git checkout main
git pull origin main
```

- [ ] **Step 2:** Tag v0.2.0

```bash
git tag -a v0.2.0 -m "Release v0.2.0

Parity alignment with aws-langgraph-dynamodb-ts:
CI + tests + shared/ refactor + OIDC publishing.

See CHANGELOG.md for full details."
```

- [ ] **Step 3:** Push the tag

```bash
git push origin v0.2.0
```

- [ ] **Step 4:** Watch the release workflow

Go to https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions. Watch the `Release NPM Package` workflow complete.

Expected:
- All steps pass
- `npm publish` succeeds
- A GitHub release for `v0.2.0` appears with auto-generated notes

### Task 5.5: Verify the publish

**Files:** none (verification only)

- [ ] **Step 1:** Confirm the package shows on npm with provenance

Open https://www.npmjs.com/package/@farukada/aws-langchain-s3-vector-ts.

Expected: the version dropdown shows `0.2.0`; a green "Provenance" badge is visible on the version page.

- [ ] **Step 2:** Check metadata via CLI

```bash
npm view @farukada/aws-langchain-s3-vector-ts@0.2.0 --json
```
Expected: output includes an `attestations` or equivalent field populated by the provenance publisher. (Field name may be `attestations.provenance`, `dist.attestations`, or similar — the exact key varies by npm CLI version; the presence of any attestation metadata is the acceptance bar.)

- [ ] **Step 3:** Optional smoke install

```bash
cd /tmp && mkdir s3v-smoke && cd s3v-smoke && npm init -y && npm install @farukada/aws-langchain-s3-vector-ts@0.2.0 && node -e "const m = require('@farukada/aws-langchain-s3-vector-ts'); console.log(Object.keys(m));"
```
Expected: prints `['AmazonS3Vectors', 'cosineRelevanceScoreFn', 'euclideanRelevanceScoreFn']` (or the ESM equivalent via dynamic import).

---

## Rollback playbook (reference — not a checklist)

**Before push-to-main:** any phase can be undone with `git reset --hard HEAD~1` on `feat/parity-alignment`. No remote impact.

**After push-to-main but before tag:** use `git revert <sha>` to create a reverting commit, then push.

**After `v0.2.0` publish:** npm publishes cannot be unpublished (outside a 72-hour window). Use:
```bash
npm deprecate @farukada/aws-langchain-s3-vector-ts@0.2.0 "<reason>"
```
and publish `v0.2.1` with the fix.

**If Trusted Publishing fails at tag time:** replace the `npm publish --access public` step in `release.yml` with:
```yaml
      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
and ensure an `NPM_TOKEN` secret with publish scope is configured on the repo. Commit this change, re-tag, re-push. Restore Trusted Publishing in a follow-up once the underlying npmjs.com config is corrected.
