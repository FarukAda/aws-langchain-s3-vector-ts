# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@farukada/aws-langchain-s3-vector-ts` — a LangChain-compatible vector store for **Amazon S3 Vectors**, written in TypeScript. It is the TypeScript counterpart of the Python `langchain-aws` `AmazonS3Vectors` store; feature parity with that implementation is a deliberate goal (batch sizes, per-batch embedding, duplicate-id deep-copy semantics, relevance-score heuristics all mirror it). The package is ESM-only and ships a single public class plus a few helpers.

## Coding rules (binding)

Standard for every change — no exceptions without explicit user sign-off.

- **Naming:** describe what the thing does. Files/dirs `kebab-case`; types/interfaces/enums/classes `PascalCase`; variables/functions `camelCase`; constants `SCREAMING_SNAKE_CASE`. No magic numbers/strings — use named constants.
- **Comments:** JSDoc only. No inline `//` or `/* */` narrative comments.
- **Exports:** no re-exports except the public entry point `src/index.ts`.
- **Files:** max 150 lines/file. One concern per file. Single responsibility per function. No circular deps.
- **Duplication:** none — extract and reuse.
- **Dead code:** none.
- **Simplicity:** no overengineering. ESLint-enforced `max-depth ≤ 3` and cyclomatic `complexity ≤ 10`. Prefer a well-named helper over deeper nesting; don't over-decompose to chase the number.
- **Types:** no `any` or `unknown`. Model everything with interfaces/enums. (Two `any`/`unsafe` escapes exist, both for AWS credential types and both carry a justifying `eslint-disable` comment — match that pattern, don't add new ones.)
- **Errors:** thrown, wrapped, and surfaced one consistent way. No silent failures.
- **Testing:** 100% coverage, enforced — `jest.config.cjs` `coverageThreshold.global` is 100 on all four metrics. Tests assert real outcomes, not coverage padding. Never lower the thresholds. When a branch is genuinely unreachable, remove the dead code rather than ignore it.
- **Dev tooling:** never disable/exclude linters or add blanket ignore rules to make checks pass.

## Commands

```bash
npm run build          # prebuild cleans dist/, then tsc → dist/
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src + test
npm run lint:fix       # eslint --fix
npm test               # jest unit tests (ESM via --experimental-vm-modules), collects coverage
npm run test:watch     # jest --watch

npm test -- test/delete.test.ts          # single file
npm test -- -t "name of the test"        # single test by name
```

Run `npm run lint` and `npm run typecheck` before declaring work done.

Jest runs through `node --experimental-vm-modules node_modules/jest/bin/jest.js` (not the bare `jest` binary) because the package is ESM. The config maps `.js` import specifiers back to `.ts` source (`moduleNameMapper`), so **keep the `.js` extension on relative imports** in `src/` — it is required for NodeNext resolution and the tests depend on it.

### Heavy commands — ask first

Do **not** run these without asking, and never in parallel: `npm run cpd`/`cpd:full`/`cpd:test` (jscpd), `npm run unused` (knip), `npm run depcheck`, `npm run test:mutate` (Stryker). `test:mutate:quick` mutates only `src/shared/**` + `src/relevance-scores.ts`.

### Integration tests (real AWS — not Docker)

Despite the generic `/init` template, there is **no Docker / LocalStack setup** here: LocalStack does not support `s3vectors`. Integration tests hit a real AWS account with a pre-created S3 vector bucket and are off by default.

```bash
RUN_LIVE_INTEGRATION=1 AWS_VECTOR_BUCKET=<bucket> AWS_REGION=us-east-1 npm run test:integration
```

The guard in `test/integration/_guard.ts` returns `null` and the suite skips itself unless `RUN_LIVE_INTEGRATION=1` and `AWS_VECTOR_BUCKET` are both set — no false pass, no false fail.

### Real-AWS verification scripts (`examples/`)

Standalone scripts (`npm run verify`, or `verify:core` / `verify:search` / `verify:edge`) exercise the full public API against live S3 Vectors using **real Bedrock embeddings** (Amazon Titan Text Embeddings V2). Each imports the built `dist/`, provisions a unique `verify-*` index, prints `PASS/FAIL`, tears its index down in a `finally`, and sets a non-zero exit code on failure. They require `AWS_VECTOR_BUCKET` (+ `AWS_REGION`) and Bedrock model access. `@langchain/aws` (the Bedrock provider) is a **devDependency only** — it is never imported by `src/` and never ships in `dist`. The shared `examples/_harness.mjs` (check/expectThrow/summary) and `examples/_embeddings.mjs` (model factory) back the three scripts. These `.mjs` files are not unit-tested; they are validated by `node --check` and by running them against real AWS.

## Architecture

The whole library is one class with its logic split into small single-concern modules.

- **`src/s3-vectors.ts`** — `AmazonS3Vectors extends VectorStore` (LangChain). The only stateful module; orchestrates every AWS `S3VectorsClient` command. The required LangChain abstract method is `similaritySearchVectorWithScore`; everything else (`addDocuments`, `addVectors`, `addTexts`, `similaritySearchWithScore`, `similaritySearchByVector`, `delete`, `getByIds`, static `fromTexts`/`fromDocuments`) is parity API on top of it.
- **`src/types.ts`** — all interfaces/contracts: `AmazonS3VectorsConfig`, `DistanceMetric`, `VectorDataType`, `S3OutputVector`, `S3VectorsDeleteParams`. No logic.
- **`src/relevance-scores.ts`** — pure distance→relevance conversions (`cosineRelevanceScoreFn`, `euclideanRelevanceScoreFn`). Selected by `_selectRelevanceScoreFn` based on `distanceMetric` unless a custom `relevanceScoreFn` is configured.
- **`src/shared/metadata.ts`** — pure helpers `buildPutMetadata` / `createDocument`. These own the round-trip of `pageContent` ↔ S3 metadata under `pageContentMetadataKey`, and the duplicate-id `structuredClone` deep-copy behavior. State (the key) is passed in explicitly to keep them class-free.
- **`src/shared/errors.ts`** — `isAwsNotFoundException` type guard (matches `NotFoundException` / `ResourceNotFoundException`). Used to treat a missing index as "not found" rather than an error.
- **`src/shared/stub-embeddings.ts`** — `StubEmbeddings` placeholder for raw-vector-only workflows. Branded with a `Symbol` and detected via `isStubEmbeddings` because `instanceof` is banned by ESLint (`no-instanceof`). Calling its methods throws; query paths reject with a clear "no embedding model" error.
- **`src/index.ts`** — the single allowed re-export surface (public API).

### Key behaviors to preserve (Python parity)

- **Per-batch embedding:** `addDocuments` embeds and writes one batch at a time (default 200) to bound peak memory — do not refactor into embed-all-then-write.
- **Default batch sizes:** put 200, delete 500, get 100. These are named constants at the top of `s3-vectors.ts`.
- **Auto-create index:** on the first write batch only (`batchOffset === 0`), when `createIndexIfNotExist` (default `true`); dimension is inferred from the first vector. The vector *bucket* must already exist — the library never creates it.
- **`delete()` with no `ids` deletes the entire index**, not zero vectors. Be careful.
- **`getByIds` preserves input order, throws on any missing id**, and deep-copies metadata only when duplicate ids are present.
- **Distance vs. score:** S3 Vectors returns raw distance (lower = more similar). `similaritySearchVectorWithScore` returns that raw distance; relevance-score functions invert it to "higher is better."
- **Client precedence:** a provided `config.client` (with a callable `send`) wins over `region`/`credentials`/`endpoint`.

## Conventions

- Prettier: single quotes, semicolons, `printWidth: 100`, `tabWidth: 2`, `trailingComma: all`.
- Imports are auto-sorted by `eslint-plugin-perfectionist` (builtin → external → internal → parent/sibling → index, blank line between groups).
- Tests mock AWS via `aws-sdk-client-mock`; use `createMockClient` / `createMockEmbeddings` from `test/helpers.ts` and `mock.reset()` in `beforeEach`. Test files live flat in `test/` (the 100%-coverage rule's `test/` mirrors `src/` layout is the target as the suite grows).
- Node `>=22.14.0`, npm `>=10`. `target`/`lib` ES2024, `module`/`moduleResolution` NodeNext.
- Commit messages: **never** add a `Co-Authored-By: Claude` trailer or any AI-attribution anywhere in the repo.
- CI (`.github/workflows/ci.yml`) runs on push to `main` only (no `pull_request` trigger): lint+typecheck, test matrix (Node 22/24 × ubuntu/windows/macos) + build, and `npm audit --omit=dev --audit-level=high`.