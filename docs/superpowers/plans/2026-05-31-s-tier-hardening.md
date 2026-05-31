# S+ Tier Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach 100% unit-test coverage with real-outcome assertions and add standalone real-AWS verification scripts for every public API.

**Architecture:** Phase 1 closes coverage gaps with direct unit tests for the shared modules (`test/shared/` mirroring `src/shared/`) plus two `s3-vectors` branch tests, then raises the Jest threshold to 100. Phase 2 adds an `examples/` directory of standalone `.mjs` scripts (shared harness + Bedrock embeddings factory + three verify scripts) that run against live AWS. Phase 3 updates docs and adds the package scripts + dev dependency.

**Tech Stack:** TypeScript (ESM, NodeNext), Jest + ts-jest (`--experimental-vm-modules`), `aws-sdk-client-mock`, `@aws-sdk/client-s3vectors`, `@langchain/core`, `@langchain/aws` (Bedrock, devDependency).

**Branch:** `s-tier-hardening` (already created; spec committed there).

---

## Phase 1 — Coverage to 100%

Current: 96.00 stmts / 84.76 branch / 91.89 funcs / 97.03 lines. The shared modules are only exercised indirectly today; the coding rule requires `test/` to mirror `src/`, so the shared tests go under `test/shared/`.

### Task 1: Direct unit tests for `shared/errors.ts`

**Files:**
- Create: `test/shared/errors.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from '@jest/globals';

import { isAwsNotFoundException } from '../../src/shared/errors.js';

describe('isAwsNotFoundException', () => {
  it('returns false for non-object inputs', () => {
    expect(isAwsNotFoundException(null)).toBe(false);
    expect(isAwsNotFoundException(undefined)).toBe(false);
    expect(isAwsNotFoundException('NotFoundException')).toBe(false);
    expect(isAwsNotFoundException(42)).toBe(false);
  });

  it('returns false for an object without a matching name', () => {
    expect(isAwsNotFoundException({})).toBe(false);
    expect(isAwsNotFoundException({ name: 'ValidationException' })).toBe(false);
  });

  it('returns true for the two recognised not-found error names', () => {
    expect(isAwsNotFoundException({ name: 'NotFoundException' })).toBe(true);
    expect(isAwsNotFoundException({ name: 'ResourceNotFoundException' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/shared/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add test/shared/errors.test.ts
git commit -m "test: cover isAwsNotFoundException branches"
```

### Task 2: Direct unit tests for `shared/metadata.ts`

**Files:**
- Create: `test/shared/metadata.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const PAGE_CONTENT_KEY = '_page_content';

describe('buildPutMetadata', () => {
  it('stores pageContent under the key when key is set', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, PAGE_CONTENT_KEY)).toEqual({
      genre: 'scifi',
      [PAGE_CONTENT_KEY]: 'hello',
    });
  });

  it('omits pageContent when key is null', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, null)).toEqual({ genre: 'scifi' });
  });
});

describe('createDocument', () => {
  it('restores pageContent and strips the key from metadata', () => {
    const doc = createDocument(
      { key: 'id-1', metadata: { genre: 'scifi', [PAGE_CONTENT_KEY]: 'hello' } },
      PAGE_CONTENT_KEY,
    );
    expect(doc.pageContent).toBe('hello');
    expect(doc.id).toBe('id-1');
    expect(doc.metadata).toEqual({ genre: 'scifi' });
  });

  it('falls back to empty pageContent when stored value is not a string', () => {
    const doc = createDocument(
      { key: 'id-2', metadata: { [PAGE_CONTENT_KEY]: 123 } },
      PAGE_CONTENT_KEY,
    );
    expect(doc.pageContent).toBe('');
  });

  it('leaves metadata untouched when the key is absent', () => {
    const doc = createDocument({ key: 'id-3', metadata: { genre: 'scifi' } }, PAGE_CONTENT_KEY);
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ genre: 'scifi' });
  });

  it('treats missing metadata as an empty object', () => {
    const doc = createDocument({ key: 'id-4' }, PAGE_CONTENT_KEY);
    expect(doc.metadata).toEqual({});
  });

  it('deep-copies metadata when deepCopyMetadata is true', () => {
    const shared = { genre: 'scifi' };
    const doc = createDocument({ key: 'id-5', metadata: shared }, null, true);
    (doc.metadata as { genre: string }).genre = 'mutated';
    expect(shared.genre).toBe('scifi');
  });

  it('never strips the key when pageContentMetadataKey is null', () => {
    const doc = createDocument(
      { key: 'id-6', metadata: { [PAGE_CONTENT_KEY]: 'kept' } },
      null,
    );
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ [PAGE_CONTENT_KEY]: 'kept' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/shared/metadata.test.ts`
Expected: PASS (all tests).

- [ ] **Step 3: Commit**

```bash
git add test/shared/metadata.test.ts
git commit -m "test: cover metadata build/create branches"
```

### Task 3: Direct unit tests for `shared/stub-embeddings.ts`

**Files:**
- Create: `test/shared/stub-embeddings.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from '@jest/globals';

import { isStubEmbeddings, StubEmbeddings } from '../../src/shared/stub-embeddings.js';

describe('StubEmbeddings', () => {
  it('rejects embedDocuments with a clear error', async () => {
    await expect(new StubEmbeddings().embedDocuments(['x'])).rejects.toThrow(
      'No embedding model configured',
    );
  });

  it('rejects embedQuery with a clear error', async () => {
    await expect(new StubEmbeddings().embedQuery('x')).rejects.toThrow(
      'No embedding model configured',
    );
  });
});

describe('isStubEmbeddings', () => {
  it('is true for a StubEmbeddings instance', () => {
    expect(isStubEmbeddings(new StubEmbeddings())).toBe(true);
  });

  it('is false for real embeddings and non-objects', () => {
    expect(isStubEmbeddings({ embedDocuments: async () => [], embedQuery: async () => [] })).toBe(
      false,
    );
    expect(isStubEmbeddings(null)).toBe(false);
    expect(isStubEmbeddings('stub')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/shared/stub-embeddings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add test/shared/stub-embeddings.test.ts
git commit -m "test: cover StubEmbeddings throw paths and guard"
```

### Task 4: Cover the SDK-client construction branch (`s3-vectors.ts:122-131`)

The constructor only builds a real `S3VectorsClient` when no callable `client.send` is provided. Today every test passes a mock client, so the `else` branch is uncovered.

**Files:**
- Modify: `test/constructor.test.ts`

- [ ] **Step 1: Add tests to the existing `describe('AmazonS3Vectors constructor', ...)` block**

```ts
  it('constructs a real S3VectorsClient when no client is supplied', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      endpoint: 'https://example.test',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(store.vectorBucketName).toBe('test-bucket');
  });

  it('builds its own client when the supplied client has no send method', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the no-send fallback
      client: {} as any,
      region: 'us-east-1',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
  });
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/constructor.test.ts`
Expected: PASS (5 tests total in the file).

- [ ] **Step 3: Commit**

```bash
git add test/constructor.test.ts
git commit -m "test: cover real-client construction fallback"
```

### Task 5: Cover the empty-batch dimension guard (`s3-vectors.ts:507-510`)

Line 509 throws `Cannot determine vector dimension from empty batch`. It is reachable when the first batch of `addDocuments` produces an empty vector array (an embeddings model that returns `[]` for non-empty input).

**Files:**
- Create: `test/empty-batch.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { jest } from '@jest/globals';
import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors empty-batch dimension guard', () => {
  it('throws when embeddings yield no vectors for a non-empty batch', async () => {
    const { client, mock } = createMockClient();
    const notFound = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFound);

    const emptyEmbeddings: EmbeddingsInterface = {
      embedDocuments: jest.fn(async () => []),
      embedQuery: jest.fn(async () => []),
    } as unknown as EmbeddingsInterface;

    const store = new AmazonS3Vectors(emptyEmbeddings, { ...BASE_CONFIG, client });

    await expect(
      store.addDocuments([new Document({ pageContent: 'orphan' })], { ids: ['id-1'] }),
    ).rejects.toThrow('Cannot determine vector dimension from empty batch');
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/empty-batch.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add test/empty-batch.test.ts
git commit -m "test: cover empty-batch dimension guard"
```

### Task 6: Verify 100% and raise the Jest threshold

**Files:**
- Modify: `jest.config.cjs:29-36`

- [ ] **Step 1: Run the full suite and confirm 100%**

Run: `npm test`
Expected: coverage table shows `100 | 100 | 100 | 100` on `All files` and no uncovered line numbers. If any remain, add targeted tests before continuing.

- [ ] **Step 2: Raise the thresholds**

Replace the `coverageThreshold` block:

```js
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
```

- [ ] **Step 3: Run again to confirm the gate passes**

Run: `npm test`
Expected: PASS, no "coverage threshold not met" error.

- [ ] **Step 4: Commit**

```bash
git add jest.config.cjs
git commit -m "test: enforce 100% coverage threshold"
```

---

## Phase 2 — Real-AWS verification scripts

Standalone scripts under `examples/`. They import the **built** package (`../dist/index.js`), so a build must run first (the `verify` script handles this). They require live AWS: an existing S3 vector bucket (`AWS_VECTOR_BUCKET`), a region (`AWS_REGION`), and Bedrock access to Titan Text Embeddings V2.

### Task 7: Shared harness

**Files:**
- Create: `examples/_harness.mjs`

- [ ] **Step 1: Write the harness**

```js
let passed = 0;
let failed = 0;

const DEFAULT_REGION = 'us-east-1';

export function section(name) {
  console.log(`\n── ${name} ──`);
}

export function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) passed += 1;
  else failed += 1;
}

export async function expectThrow(label, fn, code) {
  try {
    await fn();
    check(label, false);
  } catch (error) {
    const name = error?.name ?? '';
    const message = error?.message ?? '';
    check(label, name === code || message.includes(code));
  }
}

export function summary() {
  console.log(`\n==== ${passed} passed, ${failed} failed ====`);
  if (failed > 0) process.exitCode = 1;
}

export function requireEnv() {
  const bucketName = process.env.AWS_VECTOR_BUCKET;
  const region = process.env.AWS_REGION ?? DEFAULT_REGION;
  if (!bucketName) {
    console.error('Set AWS_VECTOR_BUCKET (and optionally AWS_REGION) to run verification.');
    process.exit(1);
  }
  return { bucketName, region };
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check examples/_harness.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add examples/_harness.mjs
git commit -m "test: add real-AWS verification harness"
```

### Task 8: Bedrock embeddings factory

**Files:**
- Create: `examples/_embeddings.mjs`

- [ ] **Step 1: Write the factory**

```js
import { BedrockEmbeddings } from '@langchain/aws';

const TITAN_V2_MODEL_ID = 'amazon.titan-embed-text-v2:0';

export function createEmbeddings(region) {
  return new BedrockEmbeddings({ region, model: TITAN_V2_MODEL_ID });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check examples/_embeddings.mjs`
Expected: no output, exit 0. (Resolving `@langchain/aws` happens in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add examples/_embeddings.mjs
git commit -m "test: add Bedrock Titan embeddings factory for verification"
```

### Task 9: `verify-core.mjs` — CRUD + lifecycle

**Files:**
- Create: `examples/verify-core.mjs`

- [ ] **Step 1: Write the script**

```js
import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectThrow, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const indexName = `verify-core-${randomUUID().slice(0, 8)}`;
const store = new AmazonS3Vectors(createEmbeddings(region), {
  vectorBucketName: bucketName,
  indexName,
  region,
});

try {
  section('addDocuments auto-creates the index on first write');
  const ids = await store.addDocuments(
    [
      new Document({ pageContent: 'the quick brown fox', metadata: { kind: 'animal' } }),
      new Document({ pageContent: 'a distant spiral galaxy', metadata: { kind: 'space' } }),
    ],
    { ids: ['core-1', 'core-2'] },
  );
  check('returns the provided ids', ids.join(',') === 'core-1,core-2');

  section('getByIds preserves input order and round-trips data');
  const docs = await store.getByIds(['core-2', 'core-1']);
  check('order preserved', docs[0].id === 'core-2' && docs[1].id === 'core-1');
  check('metadata round-trips', docs[1].metadata.kind === 'animal');
  check('pageContent round-trips', docs[1].pageContent === 'the quick brown fox');

  section('addTexts wraps texts into documents');
  const textIds = await store.addTexts(['warm friendly hello'], [{ kind: 'greeting' }], {
    ids: ['core-3'],
  });
  check('returns the provided id', textIds[0] === 'core-3');

  section('addVectors stores a precomputed vector');
  const [probe] = await createEmbeddings(region).embedDocuments(['precomputed sample']);
  const vecIds = await store.addVectors([probe], [new Document({ pageContent: 'precomputed' })], {
    ids: ['core-4'],
  });
  check('returns the provided id', vecIds[0] === 'core-4');

  section('delete by id removes a single vector');
  await store.delete({ ids: ['core-3'] });
  await expectThrow('deleted id is no longer retrievable', () => store.getByIds(['core-3']), 'not found');
} finally {
  await store.delete().catch(() => {});
}

summary();
```

- [ ] **Step 2: Syntax check**

Run: `node --check examples/verify-core.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add examples/verify-core.mjs
git commit -m "test: add real-AWS core CRUD verification script"
```

### Task 10: `verify-search.mjs` — search surface + metrics

**Files:**
- Create: `examples/verify-search.mjs`

- [ ] **Step 1: Write the script**

```js
import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const CORPUS = [
  new Document({ pageContent: 'cats and dogs are common pets', metadata: { topic: 'pets' } }),
  new Document({ pageContent: 'rockets travel to the moon and mars', metadata: { topic: 'space' } }),
  new Document({ pageContent: 'pasta and pizza are italian dishes', metadata: { topic: 'food' } }),
];

async function seed(distanceMetric) {
  const indexName = `verify-search-${distanceMetric}-${randomUUID().slice(0, 8)}`;
  const store = new AmazonS3Vectors(embeddings, {
    vectorBucketName: bucketName,
    indexName,
    region,
    distanceMetric,
  });
  await store.addDocuments(CORPUS, { ids: ['s-1', 's-2', 's-3'] });
  return store;
}

const cosine = await seed('cosine');
const euclidean = await seed('euclidean');

try {
  section('similaritySearch returns the most relevant document first');
  const top = await cosine.similaritySearch('space exploration', 1);
  check('semantically nearest doc returned', top[0].metadata.topic === 'space');

  section('similaritySearchWithScore returns [doc, distance] tuples');
  const scored = await cosine.similaritySearchWithScore('italian cuisine', 1);
  check('tuple shape', Array.isArray(scored[0]) && typeof scored[0][1] === 'number');
  check('food doc ranked first', scored[0][0].metadata.topic === 'food');

  section('similaritySearchByVector accepts a raw query vector');
  const qVec = await embeddings.embedQuery('household animals');
  const byVec = await cosine.similaritySearchByVector(qVec, 1);
  check('pets doc returned', byVec[0].metadata.topic === 'pets');

  section('metadata filter narrows the candidate set');
  const filtered = await cosine.similaritySearch('anything', 3, { topic: 'space' });
  check('only matching topic returned', filtered.every((d) => d.metadata.topic === 'space'));

  section('relevance-score function follows the distance metric');
  check('cosine selects cosine scorer', cosine._selectRelevanceScoreFn()(0) === 1);
  check('euclidean selects euclidean scorer', euclidean._selectRelevanceScoreFn()(0) === 1);
} finally {
  await cosine.delete().catch(() => {});
  await euclidean.delete().catch(() => {});
}

summary();
```

- [ ] **Step 2: Syntax check**

Run: `node --check examples/verify-search.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add examples/verify-search.mjs
git commit -m "test: add real-AWS search + metric verification script"
```

### Task 11: `verify-edge-cases.mjs` — parity edge cases

**Files:**
- Create: `examples/verify-edge-cases.mjs`

- [ ] **Step 1: Write the script**

```js
import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectThrow, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const noContentIndex = `verify-edge-nc-${randomUUID().slice(0, 8)}`;
const rawIndex = `verify-edge-raw-${randomUUID().slice(0, 8)}`;
const dupIndex = `verify-edge-dup-${randomUUID().slice(0, 8)}`;

const noContentStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: noContentIndex,
  region,
  pageContentMetadataKey: null,
});
const rawStore = new AmazonS3Vectors(undefined, {
  vectorBucketName: bucketName,
  indexName: rawIndex,
  region,
});
const dupStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: dupIndex,
  region,
});

try {
  section('pageContentMetadataKey: null embeds but does not store content');
  await noContentStore.addDocuments([new Document({ pageContent: 'secret body', metadata: { a: 1 } })], {
    ids: ['nc-1'],
  });
  const [ncDoc] = await noContentStore.getByIds(['nc-1']);
  check('pageContent not persisted', ncDoc.pageContent === '');
  check('user metadata preserved', ncDoc.metadata.a === 1);

  section('raw-vector store works without an embedding model');
  const sample = await embeddings.embedDocuments(['raw vector sample']);
  await rawStore.addVectors(sample, [new Document({ pageContent: 'raw' })], { ids: ['raw-1'] });
  const [rawDoc] = await rawStore.getByIds(['raw-1']);
  check('vector stored and retrieved', rawDoc.id === 'raw-1');
  await expectThrow(
    'text query without embeddings throws',
    () => rawStore.similaritySearchWithScore('anything', 1),
    'No embedding model',
  );

  section('getByIds throws for a missing id');
  await expectThrow('missing id rejected', () => rawStore.getByIds(['does-not-exist']), 'not found');

  section('duplicate ids in getByIds return isolated metadata copies');
  await dupStore.addDocuments([new Document({ pageContent: 'dup', metadata: { tag: 'orig' } })], {
    ids: ['dup-1'],
  });
  const dupDocs = await dupStore.getByIds(['dup-1', 'dup-1']);
  dupDocs[0].metadata.tag = 'mutated';
  check('second copy unaffected by mutation', dupDocs[1].metadata.tag === 'orig');
} finally {
  await noContentStore.delete().catch(() => {});
  await rawStore.delete().catch(() => {});
  await dupStore.delete().catch(() => {});
}

summary();
```

- [ ] **Step 2: Syntax check**

Run: `node --check examples/verify-edge-cases.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add examples/verify-edge-cases.mjs
git commit -m "test: add real-AWS edge-case verification script"
```

### Task 12: Wire up scripts + dev dependency

**Files:**
- Modify: `package.json` (scripts block + devDependencies)

- [ ] **Step 1: Add the dev dependency**

Run: `npm install --save-dev @langchain/aws`
Expected: `@langchain/aws` appears under `devDependencies`; lockfile updates.

- [ ] **Step 2: Add the verify scripts to `package.json` `scripts`**

```json
    "verify": "npm run build && node examples/verify-core.mjs && node examples/verify-search.mjs && node examples/verify-edge-cases.mjs",
    "verify:core": "npm run build && node examples/verify-core.mjs",
    "verify:search": "npm run build && node examples/verify-search.mjs",
    "verify:edge": "npm run build && node examples/verify-edge-cases.mjs",
```

- [ ] **Step 3: Confirm `@langchain/aws` resolves from the examples**

Run: `node --input-type=module -e "import('@langchain/aws').then((m) => console.log(typeof m.BedrockEmbeddings))"`
Expected: prints `function`.

- [ ] **Step 4: Confirm the published surface is unaffected**

Run: `npm run build && npm run typecheck`
Expected: both pass; `dist/` contains no reference to `@langchain/aws` (it is only used by `examples/`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: add verify scripts and @langchain/aws dev dependency"
```

---

## Phase 3 — Documentation

### Task 13: Document verification + coverage in README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a coverage badge near the top of `README.md`**

Place alongside any existing badges (or directly under the title if none):

```markdown
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
```

- [ ] **Step 2: Add a "Verifying against real AWS" section to `README.md`**

```markdown
## Verifying against real AWS

LocalStack does not support `s3vectors`, so verification runs against a real AWS
account. You need an existing S3 vector bucket and Bedrock access to Amazon Titan
Text Embeddings V2 (`amazon.titan-embed-text-v2:0`).

```bash
export AWS_VECTOR_BUCKET=<your-vector-bucket>
export AWS_REGION=us-east-1
npm run verify          # core + search + edge-case scripts, builds first
# or individually:
npm run verify:core
npm run verify:search
npm run verify:edge
```

Each script provisions a unique `verify-*` index, exercises the public API,
prints a `PASS/FAIL` summary, tears its index down, and exits non-zero on any
failure.
```

- [ ] **Step 3: Update `CLAUDE.md`**

Under the "Integration tests" section, add a paragraph documenting the verify scripts, the `@langchain/aws` devDependency (examples-only, never shipped in `dist`), the Bedrock model-access requirement, and that `jest.config.cjs` now enforces 100% coverage. Update the existing line that says thresholds "sit at 80%" to state they are now 100%.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document real-AWS verification and 100% coverage"
```

---

## Final verification

- [ ] **Run the full unit gate**

Run: `npm test`
Expected: all suites pass; coverage `100/100/100/100`; threshold gate green.

- [ ] **Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean.

- [ ] **Real-AWS verification (requires credentials + Bedrock access)**

Run: `AWS_VECTOR_BUCKET=<bucket> AWS_REGION=us-east-1 npm run verify`
Expected: three scripts each end with `==== N passed, 0 failed ====`; overall exit 0.

---

## Self-review notes

- **Spec coverage:** §1 success criteria → Tasks 1–6 (100% coverage) + Task 6 threshold; §2 gap table → Tasks 1–5 (each row mapped); §3 verify scripts → Tasks 7–11; §4 deps/scripts/CI/docs → Tasks 12–13; §5 Stryker out of scope → not touched. All covered.
- **Placeholders:** none — every code step contains full code; doc steps quote the exact text to add except Task 13 Step 3, which is prose-editing an existing section (acceptable: it describes the precise edits).
- **Type/name consistency:** harness exports (`check`, `expectThrow`, `section`, `summary`, `requireEnv`) used identically across Tasks 9–11; `createEmbeddings(region)` signature consistent; `AmazonS3Vectors` constructor `(embeddings, config)` matches `src/s3-vectors.ts`; `_selectRelevanceScoreFn` is a real public method on the class.
- **Known constraint:** `.mjs` verify scripts are not unit-tested (they require live AWS); their plan-time verification is `node --check` (syntax) plus the gated real-AWS run in Final verification.