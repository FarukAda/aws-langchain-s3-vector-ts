# Road to S+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every advertised capability mechanically proven, route all errors through one typed channel, verify real-AWS behavior continuously, and remove dead tooling — reaching the sibling package's S+ bar without overengineering.

**Architecture:** Phase 1 introduces a typed error module (`src/shared/errors/`) and routes all throws/AWS failures through it. Phase 2 adds config-level SDK retry passthrough + MMR/retry docs. Phase 3 removes Stryker. Phase 4 adds contract/MMR tests + live filter-operator/retriever checks. Phase 5 adds Tier-2 polish (validation, property tests, package-smoke, types test). Phase 6 wires scheduled live-AWS CI and 1.0/observability docs.

**Tech Stack:** TypeScript (ESM, NodeNext), Jest + ts-jest, `aws-sdk-client-mock`, `fast-check` (new devDep), `@aws-sdk/client-s3vectors`, `@langchain/core`, `@langchain/aws` (devDep).

**Branch:** create `road-to-s-plus` off `s-tier-hardening` (this plan builds on that work). If `s-tier-hardening` is merged to `main` first, branch off `main` instead.

---

## Phase 1 — Typed error model

### Task 1: Error code enum

**Files:**
- Create: `src/shared/errors/error-code.ts`

- [ ] **Step 1: Write the enum**

```ts
/** Stable error codes surfaced by {@link S3VectorsError}. */
export enum S3VectorsErrorCode {
  /** Caller-supplied arguments were invalid (counts, names, empty batch). */
  VALIDATION = 'VALIDATION',
  /** A requested vector id or index was not found. */
  NOT_FOUND = 'NOT_FOUND',
  /** An operation needed an embedding model but none was configured. */
  EMBEDDINGS_MISSING = 'EMBEDDINGS_MISSING',
  /** An underlying AWS S3 Vectors request failed. */
  AWS_REQUEST_FAILED = 'AWS_REQUEST_FAILED',
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/errors/error-code.ts
git commit -m "feat: add S3VectorsErrorCode enum"
```

### Task 2: S3VectorsError class + guard

**Files:**
- Create: `src/shared/errors/s3-vectors-error.ts`
- Test: `test/shared/errors/s3-vectors-error.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import {
  isS3VectorsError,
  S3VectorsError,
} from '../../../src/shared/errors/s3-vectors-error.js';

describe('S3VectorsError', () => {
  it('carries code, context, and cause', () => {
    const cause = new Error('boom');
    const err = new S3VectorsError('failed', S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'PutVectors',
      indexName: 'idx',
    }, cause);

    expect(err.message).toBe('failed');
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.context.operation).toBe('PutVectors');
    expect(err.context.indexName).toBe('idx');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('S3VectorsError');
  });

  it('is identified by the guard without instanceof', () => {
    const err = new S3VectorsError('x', S3VectorsErrorCode.VALIDATION, { operation: 'ctor' });
    expect(isS3VectorsError(err)).toBe(true);
    expect(isS3VectorsError(new Error('x'))).toBe(false);
    expect(isS3VectorsError(null)).toBe(false);
    expect(isS3VectorsError('S3VectorsError')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `npm test -- test/shared/errors/s3-vectors-error.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
import { S3VectorsErrorCode } from './error-code.js';

/** Structured context attached to every {@link S3VectorsError}. */
export interface S3VectorsErrorContext {
  /** The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`). */
  readonly operation: string;
  readonly vectorBucketName?: string;
  readonly indexName?: string;
}

const S3_VECTORS_ERROR_BRAND = Symbol('S3VectorsError');

/**
 * The single error type surfaced by this library. Wraps validation failures,
 * not-found conditions, and underlying AWS errors behind one consistent shape.
 */
export class S3VectorsError extends Error {
  readonly [S3_VECTORS_ERROR_BRAND] = true;
  readonly code: S3VectorsErrorCode;
  readonly context: S3VectorsErrorContext;

  constructor(
    message: string,
    code: S3VectorsErrorCode,
    context: S3VectorsErrorContext,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'S3VectorsError';
    this.code = code;
    this.context = context;
  }
}

/** Type guard for {@link S3VectorsError} that avoids `instanceof`. */
export function isS3VectorsError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, boolean>)[S3_VECTORS_ERROR_BRAND] === true
  );
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test -- test/shared/errors/s3-vectors-error.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/errors/s3-vectors-error.ts test/shared/errors/s3-vectors-error.test.ts
git commit -m "feat: add S3VectorsError type and guard"
```

### Task 3: Move the not-found guard + add wrap-error

**Files:**
- Create: `src/shared/errors/aws-not-found.ts`
- Create: `src/shared/errors/wrap-error.ts`
- Delete: `src/shared/errors.ts`
- Move: `test/shared/errors.test.ts` → `test/shared/errors/aws-not-found.test.ts`
- Test: `test/shared/errors/wrap-error.test.ts`

- [ ] **Step 1: Create `aws-not-found.ts` (verbatim move of the existing guard)**

```ts
/** Type guard for AWS SDK NotFoundException-shaped errors. */
export function isAwsNotFoundException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}
```

- [ ] **Step 2: Move the existing test and fix its import**

Move `test/shared/errors.test.ts` to `test/shared/errors/aws-not-found.test.ts` and change the import to:

```ts
import { isAwsNotFoundException } from '../../../src/shared/errors/aws-not-found.js';
```

- [ ] **Step 3: Delete the old module**

```bash
git rm src/shared/errors.ts
```

(Its only importer, `src/s3-vectors.ts`, is updated in Task 4.)

- [ ] **Step 4: Write the failing test for wrap-error**

```ts
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';
import { toError, wrapAwsError } from '../../../src/shared/errors/wrap-error.js';

describe('toError', () => {
  it('returns Error values unchanged', () => {
    const e = new Error('x');
    expect(toError(e)).toBe(e);
  });

  it('wraps non-Error values into an Error', () => {
    const e = toError('string failure');
    expect(e.message).toBe('string failure');
  });
});

describe('wrapAwsError', () => {
  it('wraps an unknown cause into a coded S3VectorsError', () => {
    const cause = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'PutVectors',
    });
    expect(isS3VectorsError(err)).toBe(true);
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.cause).toBe(cause);
  });

  it('returns an already-S3VectorsError unchanged', () => {
    const original = new S3VectorsError('v', S3VectorsErrorCode.VALIDATION, { operation: 'x' });
    expect(wrapAwsError(original, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'y' })).toBe(
      original,
    );
  });
});
```

- [ ] **Step 5: Implement `wrap-error.ts`**

```ts
import { S3VectorsErrorCode } from './error-code.js';
import {
  isS3VectorsError,
  S3VectorsError,
  type S3VectorsErrorContext,
} from './s3-vectors-error.js';

/** Normalize an unknown thrown value into an `Error`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * Wrap an unknown AWS failure into a coded {@link S3VectorsError}. An error that
 * is already an {@link S3VectorsError} is returned unchanged so the layer nearest
 * the failure keeps ownership of the message and code.
 */
export function wrapAwsError(
  cause: unknown,
  code: S3VectorsErrorCode,
  context: S3VectorsErrorContext,
): S3VectorsError {
  if (isS3VectorsError(cause)) return cause as S3VectorsError;
  const message = `${context.operation} failed: ${toError(cause).message}`;
  return new S3VectorsError(message, code, context, cause);
}
```

Note: `instanceof Error` in `toError` targets the built-in `Error`, which the `no-instanceof` rule permits (it forbids `instanceof` on user classes for control flow; the rule's own config can be checked, and a scoped `// eslint-disable-next-line no-instanceof/no-instanceof` is acceptable here if the linter flags it — confirm by running lint in Step 6).

- [ ] **Step 6: Run tests + lint**

Run: `npm test -- test/shared/errors/ && npm run lint`
Expected: PASS. If `no-instanceof` flags `toError`, add a one-line scoped disable with a JSDoc reason (built-in Error narrowing).

- [ ] **Step 7: Commit**

```bash
git add src/shared/errors/ test/shared/errors/
git commit -m "refactor: move not-found guard into errors module, add wrapAwsError"
```

### Task 4: Route s3-vectors.ts throws/AWS calls through S3VectorsError

**Files:**
- Modify: `src/s3-vectors.ts`
- Test: `test/error-surface.test.ts`

- [ ] **Step 1: Update imports in `src/s3-vectors.ts`**

Replace `import { isAwsNotFoundException } from './shared/errors.js';` with:

```ts
import { isAwsNotFoundException } from './shared/errors/aws-not-found.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { wrapAwsError } from './shared/errors/wrap-error.js';
```

- [ ] **Step 2: Add a private send wrapper and use it for every client call**

Add this private helper:

```ts
  /** Send a command, surfacing any AWS failure as a coded {@link S3VectorsError}. */
  private async _send<TOutput>(operation: string, command: { input: unknown }): Promise<TOutput> {
    try {
      return (await this._client.send(command as never)) as TOutput;
    } catch (error: unknown) {
      throw wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
        operation,
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      });
    }
  }
```

Then replace each `await this._client.send(new XCommand({...}))` with `await this._send('X', new XCommand({...}))`, EXCEPT inside `_getIndex` (which must still catch `NotFoundException` to drive auto-create — see Step 3).

- [ ] **Step 3: Update `_getIndex` to translate non-not-found errors**

```ts
  private async _getIndex(): Promise<Record<string, unknown> | null> {
    try {
      const result = await this._client.send(
        new GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
      );
      return result as unknown as Record<string, unknown>;
    } catch (error: unknown) {
      if (isAwsNotFoundException(error)) return null;
      throw wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
        operation: 'GetIndex',
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      });
    }
  }
```

- [ ] **Step 4: Convert the plain `throw new Error(...)` sites to S3VectorsError**

Replace the count-mismatch / empty-batch throws with `S3VectorsError(..., S3VectorsErrorCode.VALIDATION, { operation })`; the `getByIds` not-found throw with `S3VectorsErrorCode.NOT_FOUND`; and the `_getQueryEmbeddings` throw with `S3VectorsErrorCode.EMBEDDINGS_MISSING`. Keep the exact message text so existing assertions still match. Example for the empty-batch guard:

```ts
        if (!firstVector) {
          throw new S3VectorsError(
            'Cannot determine vector dimension from empty batch',
            S3VectorsErrorCode.VALIDATION,
            { operation: 'addDocuments', vectorBucketName: this.vectorBucketName, indexName: this.indexName },
          );
        }
```

- [ ] **Step 5: Write a test asserting AWS failures surface as typed errors**

```ts
import { PutVectorsCommand, GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = { vectorBucketName: 'test-bucket', indexName: 'test-index' } as const;

describe('AmazonS3Vectors error surface', () => {
  it('wraps AWS failures as S3VectorsError with operation context', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: {} });
    mock.on(PutVectorsCommand).rejects(
      Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    );
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    try {
      await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });
      throw new Error('should have thrown');
    } catch (error: unknown) {
      expect(isS3VectorsError(error)).toBe(true);
      const typed = error as { code: S3VectorsErrorCode; context: { operation: string } };
      expect(typed.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
      expect(typed.context.operation).toBe('PutVectors');
    }
  });
});
```

- [ ] **Step 6: Update existing tests that asserted raw AWS errors**

The `add-vectors.test.ts` case `'rethrows non-NotFound errors when checking for existing index'` currently asserts `.rejects.toMatchObject({ name: 'AccessDenied' })`. Update it to assert the wrapped error instead:

```ts
    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['id-1'] }),
    ).rejects.toMatchObject({ name: 'S3VectorsError' });
```

- [ ] **Step 7: Run the full suite + lint + typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS, coverage 100%. Fix any newly-uncovered branch in the error paths with a targeted test.

- [ ] **Step 8: Commit**

```bash
git add src/s3-vectors.ts test/
git commit -m "feat: surface all failures through typed S3VectorsError"
```

### Task 5: Export the error API

**Files:**
- Modify: `src/index.ts`
- Test: `test/index-exports.test.ts`

- [ ] **Step 1: Add exports**

```ts
export { S3VectorsError, isS3VectorsError } from './shared/errors/s3-vectors-error.js';
export type { S3VectorsErrorContext } from './shared/errors/s3-vectors-error.js';
export { S3VectorsErrorCode } from './shared/errors/error-code.js';
```

- [ ] **Step 2: Write the export test**

```ts
import { describe, it, expect } from '@jest/globals';

import {
  AmazonS3Vectors,
  S3VectorsError,
  S3VectorsErrorCode,
  isS3VectorsError,
  cosineRelevanceScoreFn,
} from '../src/index.js';

describe('public exports', () => {
  it('exposes the documented surface', () => {
    expect(typeof AmazonS3Vectors).toBe('function');
    expect(typeof S3VectorsError).toBe('function');
    expect(typeof isS3VectorsError).toBe('function');
    expect(typeof cosineRelevanceScoreFn).toBe('function');
    expect(S3VectorsErrorCode.VALIDATION).toBe('VALIDATION');
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `npm test -- test/index-exports.test.ts`
Expected: PASS.

```bash
git add src/index.ts test/index-exports.test.ts
git commit -m "feat: export S3VectorsError public API"
```

---

## Phase 2 — Retry config passthrough + MMR/retry docs

### Task 6: Add maxAttempts / retryMode config

**Files:**
- Modify: `src/types.ts`
- Modify: `src/s3-vectors.ts:122-131` (client construction)
- Test: `test/constructor.test.ts`

- [ ] **Step 1: Add config fields to `AmazonS3VectorsConfig`**

```ts
  /**
   * Maximum number of attempts (initial try + retries) for AWS requests.
   * Forwarded to the AWS SDK retry strategy. Ignored when `client` is provided.
   */
  readonly maxAttempts?: number;

  /**
   * AWS SDK retry mode. Throttling and 5xx errors are retried by the SDK.
   * Ignored when `client` is provided.
   */
  readonly retryMode?: 'standard' | 'adaptive' | 'legacy';
```

- [ ] **Step 2: Thread them into the client constructor**

In the `else` branch that builds `new S3VectorsClient({...})`, add `maxAttempts: config.maxAttempts` and `retryMode: config.retryMode`.

- [ ] **Step 3: Add a test**

```ts
  it('forwards retry options to the SDK client', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      maxAttempts: 5,
      retryMode: 'adaptive',
    });
    expect(store).toBeInstanceOf(AmazonS3Vectors);
  });
```

(The construction path is what matters for coverage; the SDK stores these internally. Asserting no-throw + instance is sufficient — do not reach into SDK internals.)

- [ ] **Step 4: Run + commit**

Run: `npm test -- test/constructor.test.ts && npm run typecheck`

```bash
git add src/types.ts src/s3-vectors.ts test/constructor.test.ts
git commit -m "feat: forward maxAttempts/retryMode to the SDK client"
```

### Task 7: MMR + retry documentation

**Files:**
- Modify: `src/s3-vectors.ts` (class JSDoc)
- Modify: `README.md`

- [ ] **Step 1: Add a `@remarks` note to the class JSDoc**

State that `maxMarginalRelevanceSearch` (MMR) is intentionally not implemented, matching the Python `langchain-aws` reference; recommend metadata pre-filtering or client-side re-ranking. State that throttling/5xx retries are handled by the AWS SDK and tunable via `maxAttempts`/`retryMode`.

- [ ] **Step 2: Add the same notes to README** (a short "Retries" line in Configuration Reference and an "MMR" line in Advanced Features / API Reference).

- [ ] **Step 3: Commit**

```bash
git add src/s3-vectors.ts README.md
git commit -m "docs: document MMR non-support and SDK retry tuning"
```

---

## Phase 3 — Remove Stryker

### Task 8: Delete Stryker scaffold and references

**Files:**
- Delete: `stryker.conf.json`, `.stryker-tmp/`, `.stryker-incremental.json` (if present)
- Modify: `package.json` (remove scripts + devDeps)
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Remove files**

```bash
git rm -f stryker.conf.json
rm -rf .stryker-tmp .stryker-incremental.json
```

- [ ] **Step 2: Remove scripts and devDependencies**

Delete the `test:mutate` and `test:mutate:quick` scripts from `package.json`, then:

```bash
npm uninstall @stryker-mutator/core @stryker-mutator/jest-runner @stryker-mutator/typescript-checker
```

- [ ] **Step 3: Remove docs references**

Delete the "Mutation testing" subsection from `README.md` and any Stryker line in `CLAUDE.md` (the "Heavy commands" list).

- [ ] **Step 4: Verify nothing references Stryker**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS. Confirm no `stryker` string remains in tracked source/config (a grep over the repo should only match plan/spec docs).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove unused Stryker mutation-testing scaffold"
```

---

## Phase 4 — Contract & behavioral verification

### Task 9: VectorStore contract test (mocked)

**Files:**
- Create: `test/contract/vector-store-contract.test.ts`

- [ ] **Step 1: Write the contract test**

```ts
import { GetIndexCommand, PutVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from '../helpers.js';

const BASE_CONFIG = { vectorBucketName: 'test-bucket', indexName: 'test-index' } as const;

function seededStore() {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).resolves({ index: {} });
  mock.on(PutVectorsCommand).resolves({});
  mock.on(QueryVectorsCommand).resolves({
    vectors: [
      { key: 'id-1', metadata: { _page_content: 'first', topic: 'a' }, distance: 0.1 },
      { key: 'id-2', metadata: { _page_content: 'second', topic: 'b' }, distance: 0.4 },
    ],
  });
  return { store: new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client }), mock };
}

describe('VectorStore contract', () => {
  it('reports a stable vectorstore type', () => {
    expect(seededStore().store._vectorstoreType()).toBe('amazonS3Vectors');
  });

  it('similaritySearch returns documents ordered by score', async () => {
    const docs = await seededStore().store.similaritySearch('q', 2);
    expect(docs.map((d) => d.id)).toEqual(['id-1', 'id-2']);
  });

  it('similaritySearchWithScore returns ascending distances', async () => {
    const scored = await seededStore().store.similaritySearchWithScore('q', 2);
    expect(scored[0]![1]).toBeLessThanOrEqual(scored[1]![1]);
  });

  it('asRetriever().invoke returns documents', async () => {
    const retriever = seededStore().store.asRetriever(2);
    const docs = await retriever.invoke('q');
    expect(docs).toHaveLength(2);
    expect(docs[0]!.id).toBe('id-1');
  });

  it('handles an empty result set', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({ vectors: [] });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    expect(await store.similaritySearch('q', 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `npm test -- test/contract/vector-store-contract.test.ts`
Expected: PASS.

```bash
git add test/contract/vector-store-contract.test.ts
git commit -m "test: add VectorStore contract tests incl. asRetriever"
```

### Task 10: MMR parity contract test

**Files:**
- Create: `test/contract/mmr.test.ts`

- [ ] **Step 1: Write the test (asserts MMR is unsupported with a clear error)**

```ts
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from '../helpers.js';

const BASE_CONFIG = { vectorBucketName: 'test-bucket', indexName: 'test-index' } as const;

describe('maxMarginalRelevanceSearch (parity: not implemented)', () => {
  it('throws a clear not-implemented error', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await expect(store.maxMarginalRelevanceSearch('q', { k: 2 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- test/contract/mmr.test.ts`
Expected: PASS (base `VectorStore.maxMarginalRelevanceSearch` throws "Not implemented"). If the base returns instead of throwing in this `@langchain/core` version, adjust to assert the actual documented behavior and add a one-line override in `s3-vectors.ts` that throws an `S3VectorsError` VALIDATION "MMR is not supported".

- [ ] **Step 3: Commit**

```bash
git add test/contract/mmr.test.ts
git commit -m "test: pin MMR-unsupported parity contract"
```

### Task 11: Live filter-operator + retriever checks

**Files:**
- Modify: `examples/verify-search.mjs`

- [ ] **Step 1: Add a filter-operator section and an asRetriever section**

Append inside the `try` block (before the relevance-score section):

```js
  section('filter operators narrow results');
  const inResults = await cosine.similaritySearch('anything', 3, {
    topic: { $in: ['space', 'food'] },
  });
  check('$in matches multiple topics', inResults.every((d) => ['space', 'food'].includes(d.metadata.topic)));
  const andResults = await cosine.similaritySearch('anything', 3, {
    $and: [{ topic: { $eq: 'space' } }, { topic: { $ne: 'food' } }],
  });
  check('$and/$ne compose', andResults.every((d) => d.metadata.topic === 'space'));

  section('asRetriever returns documents for a query');
  const retriever = cosine.asRetriever(2);
  const retrieved = await retriever.invoke('space exploration');
  check('retriever returns up to k docs', retrieved.length > 0 && retrieved.length <= 2);
```

- [ ] **Step 2: Syntax check + commit**

Run: `node --check examples/verify-search.mjs`

```bash
git add examples/verify-search.mjs
git commit -m "test: verify filter operators and asRetriever against real AWS"
```

---

## Phase 5 — Tier-2 polish

### Task 12: Early input validation

**Files:**
- Create: `src/shared/validation.ts`
- Modify: `src/s3-vectors.ts` (call validation in constructor)
- Test: `test/shared/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { assertValidIndexConfig } from '../../src/shared/validation.js';

describe('assertValidIndexConfig', () => {
  it('accepts a valid bucket and index name', () => {
    expect(() => assertValidIndexConfig('my-bucket', 'my-index.v1')).not.toThrow();
  });

  it('rejects an empty bucket name', () => {
    try {
      assertValidIndexConfig('', 'idx');
      throw new Error('should throw');
    } catch (e: unknown) {
      expect(isS3VectorsError(e)).toBe(true);
      expect((e as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    }
  });

  it('rejects an index name that is too short or malformed', () => {
    expect(() => assertValidIndexConfig('b', 'ab')).toThrow();
    expect(() => assertValidIndexConfig('b', '-bad')).toThrow();
    expect(() => assertValidIndexConfig('b', 'UPPER')).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

const INDEX_NAME_MIN_LENGTH = 3;
const INDEX_NAME_MAX_LENGTH = 63;
const INDEX_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function fail(message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation: 'constructor' });
}

/** Validate bucket and index names before any AWS call. */
export function assertValidIndexConfig(vectorBucketName: string, indexName: string): void {
  if (!vectorBucketName) fail('vectorBucketName must be a non-empty string');
  if (indexName.length < INDEX_NAME_MIN_LENGTH || indexName.length > INDEX_NAME_MAX_LENGTH) {
    fail(`indexName must be ${INDEX_NAME_MIN_LENGTH}–${INDEX_NAME_MAX_LENGTH} characters`);
  }
  if (!INDEX_NAME_PATTERN.test(indexName)) {
    fail('indexName must contain only lowercase letters, numbers, hyphens, and dots');
  }
}
```

- [ ] **Step 3: Call it in the constructor** (after assigning `vectorBucketName`/`indexName`):

```ts
    assertValidIndexConfig(this.vectorBucketName, this.indexName);
```

Add `import { assertValidIndexConfig } from './shared/validation.js';`.

- [ ] **Step 4: Fix existing tests that use too-short names**

All existing tests use `indexName: 'test-index'` (valid) and `vectorBucketName: 'test-bucket'` (valid), so they pass. Confirm by running the suite.

- [ ] **Step 5: Run + commit**

Run: `npm test && npm run lint`
Expected: PASS, 100% coverage.

```bash
git add src/shared/validation.ts src/s3-vectors.ts test/shared/validation.test.ts
git commit -m "feat: validate bucket/index names before AWS calls"
```

### Task 13: Property-based tests

**Files:**
- Modify: `package.json` (add `fast-check` devDep)
- Create: `test/property/metadata.property.test.ts`
- Create: `test/property/batching.property.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev fast-check`

- [ ] **Step 2: Metadata round-trip property**

```ts
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import fc from 'fast-check';

import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const KEY = '_page_content';

describe('metadata round-trip property', () => {
  it('preserves pageContent and user metadata for any string inputs', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(fc.string({ minLength: 1 }).filter((k) => k !== KEY), fc.string()),
        (pageContent, metadata) => {
          const put = buildPutMetadata(new Document({ pageContent, metadata }), KEY);
          const doc = createDocument({ key: 'k', metadata: put }, KEY);
          expect(doc.pageContent).toBe(pageContent);
          expect(doc.metadata).toEqual(metadata);
        },
      ),
    );
  });
});
```

- [ ] **Step 3: Batching-math property**

```ts
import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { createMockClient } from '../helpers.js';

const BASE_CONFIG = { vectorBucketName: 'test-bucket', indexName: 'test-index' } as const;

describe('delete batching property', () => {
  it('issues ceil(n / batchSize) DeleteVectors calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        async (n, batchSize) => {
          const { client, mock } = createMockClient();
          mock.on(DeleteVectorsCommand).resolves({});
          const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
          const ids = Array.from({ length: n }, (_, i) => `id-${i}`);
          await store.delete({ ids, batchSize });
          expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(Math.ceil(n / batchSize));
        },
      ),
    );
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- test/property/`
Expected: PASS.

```bash
git add package.json package-lock.json test/property/
git commit -m "test: add property-based metadata and batching tests"
```

### Task 14: Package-smoke test

**Files:**
- Create: `test/package-smoke/smoke.test.mjs`
- Modify: `package.json` (add `test:package-smoke` script + knip ignore)

- [ ] **Step 1: Write the smoke test (uses Node's built-in test runner)**

```js
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('packaged tarball exposes the public API', () => {
  execSync('npm run build', { stdio: 'inherit' });
  const tarball = execSync('npm pack --silent').toString().trim();
  const dir = mkdtempSync(join(tmpdir(), 's3v-smoke-'));
  execSync(`npm init -y`, { cwd: dir, stdio: 'ignore' });
  execSync(`npm install ${join(process.cwd(), tarball)}`, { cwd: dir, stdio: 'inherit' });

  const probe = join(dir, 'probe.mjs');
  execSync(
    `node --input-type=module -e "import('@farukada/aws-langchain-s3-vector-ts').then((m)=>{` +
      `if(typeof m.AmazonS3Vectors!=='function')process.exit(2);` +
      `if(typeof m.S3VectorsError!=='function')process.exit(3);` +
      `if(typeof m.isS3VectorsError!=='function')process.exit(4);})"`,
    { cwd: dir, stdio: 'inherit' },
  );
  assert.ok(true);
});
```

- [ ] **Step 2: Add script + knip ignore**

```json
    "test:package-smoke": "node --test test/package-smoke/smoke.test.mjs",
```

Add `"test/package-smoke/**"` to the knip ignore list if knip flags it.

- [ ] **Step 3: Run + commit**

Run: `npm run test:package-smoke`
Expected: the test passes (tarball builds, installs, imports cleanly).

```bash
git add test/package-smoke/smoke.test.mjs package.json
git commit -m "test: add packaged-tarball smoke test"
```

### Task 15: Public-API types test

**Files:**
- Create: `test/types/public-api.test-d.ts`
- Modify: `tsconfig.json` (ensure `test/types` is type-checked) or rely on a dedicated `tsc` invocation

- [ ] **Step 1: Write compile-time assertions**

```ts
import { AmazonS3Vectors } from '../../src/index.js';
import type { AmazonS3VectorsConfig, DistanceMetric } from '../../src/index.js';

// distanceMetric is constrained to the documented union.
const metric: DistanceMetric = 'cosine';
// @ts-expect-error — 'manhattan' is not a valid DistanceMetric
const bad: DistanceMetric = 'manhattan';

const config: AmazonS3VectorsConfig = { vectorBucketName: 'b', indexName: 'idx' };
const store = new AmazonS3Vectors(undefined, config);
// _vectorstoreType returns string
const t: string = store._vectorstoreType();

void metric;
void bad;
void t;
```

- [ ] **Step 2: Add a typecheck script for the type tests**

```json
    "typecheck:types": "tsc --noEmit -p tsconfig.json && tsc --noEmit --skipLibCheck test/types/public-api.test-d.ts",
```

(Or add a small `tsconfig.types.json` that includes `test/types`. Keep it simple — the goal is that `@ts-expect-error` fails the build if the type ever widens.)

- [ ] **Step 3: Run + commit**

Run: `npm run typecheck:types`
Expected: passes; if the `@ts-expect-error` has no error (type widened), tsc fails — that is the test working.

```bash
git add test/types/public-api.test-d.ts package.json
git commit -m "test: add compile-time public-API type assertions"
```

---

## Phase 6 — CI cadence + release polish

### Task 16: Scheduled live-AWS workflow

**Files:**
- Modify: `.github/workflows/integration-live.yml`

- [ ] **Step 1: Add a nightly schedule trigger (keep workflow_dispatch, no pull_request)**

```yaml
on:
  schedule:
    - cron: '0 4 * * *'
  workflow_dispatch:
    inputs:
      aws-region:
        description: 'AWS region for the test bucket'
        required: false
        default: 'us-east-1'
```

- [ ] **Step 2: Make the region resolve for the scheduled run**

Where the job uses `${{ inputs.aws-region }}`, fall back to a default for scheduled runs:

```yaml
          aws-region: ${{ inputs.aws-region || 'us-east-1' }}
```

and the same `|| 'us-east-1'` for the `AWS_REGION` env. The scheduled job runs `npm run test:integration` (the env-gated jest smoke — random embeddings, no Bedrock), which catches S3 Vectors SDK drift cheaply.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/integration-live.yml
git commit -m "ci: run live-AWS smoke nightly via OIDC"
```

### Task 17: 1.0, stability, and observability docs

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Bump version**

Set `"version": "1.0.0"` in `package.json`.

- [ ] **Step 2: Add a CHANGELOG entry** for `1.0.0` summarizing: typed `S3VectorsError`, retry config, input validation, contract/property/package-smoke tests, scheduled live-AWS, Stryker removed. Note the only behavioral change: errors are now `S3VectorsError` (messages unchanged).

- [ ] **Step 3: Add README sections**

- "Stability": 1.0 commits to semver; the public surface is `AmazonS3Vectors`, the error API, relevance fns, and exported types.
- "Observability": the library emits no logs by design; pass a pre-configured `S3VectorsClient` (with logger/middleware) via the `client` option to instrument requests.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "docs: cut 1.0 with stability and observability notes"
```

---

## Final verification

- [ ] **Unit gate:** `npm test` → all suites pass, coverage 100/100/100/100.
- [ ] **Lint + typecheck:** `npm run lint && npm run typecheck && npm run typecheck:types` → clean.
- [ ] **Package smoke:** `npm run test:package-smoke` → passes.
- [ ] **Build purity:** `npm run build` → `dist/` has no real import of `@langchain/aws` or `fast-check` (devDeps only; JSDoc `@example` string is allowed).
- [ ] **Real-AWS (needs credentials + Bedrock Titan):** `AWS_VECTOR_BUCKET=<bucket> AWS_REGION=<region> npm run verify` → every script ends `==== N passed, 0 failed ====`, including the new filter-operator and asRetriever checks.

---

## Self-review notes

- **Spec coverage:** T1.1→Tasks 1–5; T1.2→Tasks 9–11; T1.3→Tasks 6–7; T1.4→Task 8; T2.1→Task 12; T2.2→Task 13; T2.3→Task 14; T2.4→Task 15; T2.5→Task 16; T2.6→Task 17. All mapped.
- **Placeholders:** none — code steps contain full code; doc steps (7, 17) describe precise edits to prose sections.
- **Type/name consistency:** `S3VectorsError(message, code, context, cause?)` signature is identical across Tasks 2, 4, 12; `S3VectorsErrorCode` members (`VALIDATION`/`NOT_FOUND`/`EMBEDDINGS_MISSING`/`AWS_REQUEST_FAILED`) used consistently; `wrapAwsError(cause, code, context)` and `assertValidIndexConfig(vectorBucketName, indexName)` signatures stable; `isS3VectorsError` guard used uniformly.
- **Risk flags:** (a) the `no-instanceof` rule may flag `toError`'s `instanceof Error` — Task 3 Step 6 handles it. (b) MMR base behavior is version-dependent — Task 10 Step 2 has a fallback. (c) `node --test` package-smoke runs `npm pack`/install — slower; it is a dedicated script, not part of `npm test`.
- **Coverage impact:** new `src/` code (errors module, validation, `_send`, retry passthrough) must keep 100% — each task includes the tests that cover its branches; verify at Task 8/12 and the final gate.