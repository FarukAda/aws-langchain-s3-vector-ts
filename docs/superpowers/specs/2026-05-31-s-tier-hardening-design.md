# S+ Tier Hardening — Design

**Date:** 2026-05-31
**Status:** Approved
**Goal:** Bring `@farukada/aws-langchain-s3-vector-ts` to the same quality bar as the sibling package `aws-langgraph-dynamodb-ts`: 100% unit-test coverage with real-outcome assertions, and standalone real-AWS verification of every public API.

## 1. Success criteria

1. **100% unit coverage** — statements, branches, functions, and lines all at 100% in `npm test`. `jest.config.cjs` `coverageThreshold.global` raised to 100 on all four metrics and enforced (CI fails below).
2. **Real-outcome assertions** — every new test asserts a meaningful result (returned IDs, document order, thrown error message/type, metadata round-trip). No test exists solely to execute a line.
3. **Real-AWS verification** — standalone `examples/verify-*.mjs` scripts provision their own index, exercise every public API against live Amazon S3 Vectors + Amazon Bedrock embeddings, print a `PASS/FAIL` summary, tear down their resources, and set `process.exitCode = 1` on any failure.
4. **Existing jest smoke test** (`test/integration/smoke.test.ts`, env-gated by `RUN_LIVE_INTEGRATION`) remains the CI-triggerable integration path, unchanged in contract.

## 2. Coverage gaps to close

Measured from current `npm test` run (96.00 stmts / 84.76 branch / 91.89 funcs / 97.03 lines). Each gap gets a real-assertion unit test in the existing flat `test/` layout.

| File:line | Uncovered code | Test to add |
|---|---|---|
| `src/s3-vectors.ts:125` | `new S3VectorsClient({ region, credentials, endpoint })` branch (no pre-made `client`) | Construct store **without** `config.client`; assert a real `S3VectorsClient` is created and `region`/`endpoint` are applied. Cover the `client` provided but lacking callable `send` fallback path too. |
| `src/s3-vectors.ts:509` | `throw new Error('Cannot determine vector dimension from empty batch')` | Drive `_ensureIndexAndPut` first-batch path with an empty first vector so the throw fires; assert message. |
| `src/shared/errors.ts:3` | `isAwsNotFoundException` early-return branch | Call with `null`, a non-object, an object with no `name`, `NotFoundException`, `ResourceNotFoundException`, and a wrong name; assert each boolean. |
| `src/shared/metadata.ts:17` | `pageContentMetadataKey === null` branch in `buildPutMetadata` | Assert content is **not** written into metadata when key is `null`. |
| `src/shared/metadata.ts:40,47` | `createDocument` non-string stored value + key-absent branches | Assert `pageContent` falls back to `''` for a non-string stored value; assert metadata passes through untouched when key absent. |
| `src/shared/stub-embeddings.ts:15-18` | `embedDocuments` / `embedQuery` throw bodies | Assert both reject with `No embedding model configured`; assert `isStubEmbeddings` true for a stub and false for a real embeddings object and for non-objects. |

Verification: `npm test` reports 100/100/100/100 and the coverage table shows no uncovered line numbers.

## 3. Real-AWS verification scripts (`examples/`)

New top-level `examples/` directory. Pattern mirrors the sibling repo: shared harness + focused scripts, each standalone via `node examples/<name>.mjs`.

### 3.1 `examples/_harness.mjs`
Shared, no AWS calls. Exports:
- `check(label, ok)` — prints `  PASS  <label>` / `  FAIL  <label>`, increments counters.
- `expectThrow(label, fn, code)` — passes when `fn()` rejects with `err.name === code` (or message contains it); fails if it resolves.
- `section(name)` — prints a section header.
- `summary()` — prints `==== <passed> passed, <failed> failed ====` and sets `process.exitCode = 1` if any failed.
- A small helper to read required env (`AWS_VECTOR_BUCKET`, `AWS_REGION`) and exit early with a clear message if absent.

### 3.2 `examples/_embeddings.mjs`
Single place that constructs `BedrockEmbeddings` (Amazon Titan Text Embeddings V2, `amazon.titan-embed-text-v2:0`, default 1024 dimensions) from `AWS_REGION`. Swapping the model is a one-line change here.

### 3.3 `examples/verify-core.mjs`
CRUD + lifecycle:
- auto-create index on first write (`createIndexIfNotExist`),
- `addDocuments`, `addVectors`, `addTexts` (assert returned IDs),
- `getByIds` preserves input order; whole-index and by-id `delete`.
- Self-teardown of the index in `finally`.

### 3.4 `examples/verify-search.mjs`
Search surface:
- `similaritySearch`, `similaritySearchWithScore`, `similaritySearchByVector`, `similaritySearchVectorWithScore`,
- metadata filter queries,
- a cosine index and a euclidean index (separate indexes), asserting the relevance-score path differs.

### 3.5 `examples/verify-edge-cases.mjs`
- duplicate-id deep-copy isolation (mutating one returned doc's metadata does not affect another),
- missing-id `getByIds` throws,
- `pageContentMetadataKey: null` (content embedded but not stored),
- `nonFilterableMetadataKeys` honored at index creation,
- batch-boundary sizes (counts that straddle the 200/500/100 batch defaults),
- raw-vector flow with **no** embedding model (`addVectors` works; query-by-text throws the "No embedding model" error).

Each script uses a unique `smoke-<uuid>` index name and tears down in `finally` so a mid-run failure still cleans up.

## 4. Dependencies, scripts, CI, docs

- **Dependency:** add `@langchain/aws` as a **devDependency** only (pulls Bedrock embeddings). Published `dist` and `peerDependencies` are unchanged — the store itself stays embedding-agnostic.
- **npm scripts:**
  - `verify` — runs `verify-core`, `verify-search`, `verify-edge` sequentially, aggregate non-zero exit on any failure.
  - `verify:core`, `verify:search`, `verify:edge` — individual scripts.
- **`jest.config.cjs`:** `coverageThreshold.global` → `{ branches: 100, functions: 100, lines: 100, statements: 100 }`.
- **`CLAUDE.md`:** document the verify scripts, the `@langchain/aws` dev dependency, the Bedrock model-access + `AWS_VECTOR_BUCKET`/`AWS_REGION` requirements, and the 100% threshold.
- **`README.md`:** add a coverage badge and a short "Verifying against real AWS" section describing the verify scripts and required AWS access (S3 Vectors bucket + Bedrock Titan model access).

## 5. Out of scope

- **Stryker mutation testing** — left scaffolded and documented-disabled (known ESM/jest-runner limitation). Not pursued in this work.
- No change to the published runtime dependencies or the public API surface.
- No new CI job wiring for the verify scripts beyond what the existing `integration-live.yml` provides (verify scripts are developer-run; can be added to CI later).

## 6. Constraints (from repo coding rules)

- Source files obey the binding rules (kebab-case files, JSDoc-only comments, ≤150 lines, no `any`/`unknown`, named constants). Example `.mjs` scripts are dev tooling, not shipped source, but should still read cleanly and use named constants for index names / dimensions.
- No `Co-Authored-By: Claude` or AI attribution anywhere.
- Multi-phase work = local commits per phase, no per-phase PRs/pushes.