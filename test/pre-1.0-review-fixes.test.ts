/**
 * Regression tests for the fixes made in response to the pre-1.0 review
 * (docs/superpowers/code-review-findings-2026-09-02-v0.9.0-pre-1.0.md).
 * Each `describe` names the finding it pins.
 */
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';

import {
  CreateIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  indexFixture,
  mockExistingIndex,
  mockIndexAutoCreated,
} from './helpers.js';

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const CREDENTIALS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: SECRET };

describe('F3 — credentials never reach lc_kwargs or any object rendering of the store', () => {
  it('keeps credentials, the client and the embeddings models out of lc_kwargs', () => {
    const { client } = createMockClient();
    const embeddings = createMockEmbeddings();
    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
      credentials: CREDENTIALS,
      queryEmbeddings: embeddings,
      region: 'eu-west-1',
    });

    const kwargs = store.lc_kwargs as Record<string, unknown>;
    expect(kwargs).not.toHaveProperty('credentials');
    expect(kwargs).not.toHaveProperty('client');
    expect(kwargs).not.toHaveProperty('embeddings');
    expect(kwargs).not.toHaveProperty('queryEmbeddings');
    // Plain configuration is still recorded.
    expect(kwargs).toMatchObject({ ...BASE_CONFIG, region: 'eu-west-1' });
  });

  it('util.inspect / JSON.stringify of the store contain no credential material', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      credentials: CREDENTIALS,
    });

    expect(inspect(store, { depth: 6 })).not.toContain(SECRET);
    expect(inspect(store, { depth: 6 })).not.toContain(CREDENTIALS.accessKeyId);
    expect(JSON.stringify(store)).not.toContain(SECRET);
  });
});

describe('F11 — error.context.instance is a non-enumerable recovery handle', () => {
  async function failingFactoryError(): Promise<S3VectorsError> {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).rejects(new Error('boom'));
    const error = await AmazonS3Vectors.fromDocuments(
      [new Document({ pageContent: 'x' })],
      createMockEmbeddings(),
      { ...BASE_CONFIG, client, credentials: CREDENTIALS },
    ).catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    return error as S3VectorsError;
  }

  it('is still reachable by direct property access', async () => {
    const error = await failingFactoryError();
    expect(error.context.instance).toBeInstanceOf(AmazonS3Vectors);
  });

  it('is omitted by JSON.stringify, Object.keys, spread and util.inspect', async () => {
    const error = await failingFactoryError();
    expect(Object.keys(error.context)).not.toContain('instance');
    expect(JSON.parse(JSON.stringify(error.context))).not.toHaveProperty('instance');
    expect({ ...error.context }).not.toHaveProperty('instance');
    const rendered = inspect(error, { depth: 8 });
    expect(rendered).not.toContain('_client');
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain(CREDENTIALS.accessKeyId);
  });
});

describe('F4 — a PutVectors NotFound/Validation failure invalidates the cached index config', () => {
  const doc = () => new Document({ pageContent: 'x' });

  async function primeCache(): Promise<ReturnType<typeof createTestStore>> {
    const ctx = createTestStore();
    mockExistingIndex(ctx.mock);
    await ctx.store.addDocuments([doc()]);
    expect(ctx.mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    return ctx;
  }

  /** Make the *next* PutVectors reject with `error`; every later one succeeds. */
  function failNextPut(mock: ReturnType<typeof createMockClient>['mock'], error: Error): void {
    let failed = false;
    mock.on(PutVectorsCommand).callsFake(() => {
      if (!failed) {
        failed = true;
        throw error;
      }
      return {};
    });
  }

  it.each(['NotFoundException', 'ValidationException'])(
    'on %s: clears the cache, flags the error, and the next write re-checks the index',
    async (name) => {
      const { store, mock } = await primeCache();
      const awsError = Object.assign(new Error(`${name} from AWS`), {
        name,
        $metadata: { httpStatusCode: name === 'NotFoundException' ? 404 : 400 },
      });
      failNextPut(mock, awsError);

      const error = await store.addDocuments([doc()]).catch((e: unknown) => e);
      expect(isS3VectorsError(error)).toBe(true);
      const typed = error as S3VectorsError;
      expect(typed.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
      expect(typed.context.indexCacheInvalidated).toBe(true);
      expect(typed.context.awsErrorName).toBe(name);
      expect(typed.message).toContain('cached index configuration');
      expect(typed.message).toContain(`(${name}`);
      // The original writtenIds bookkeeping is preserved through the rebuild.
      expect(typed.context.writtenIds).toEqual([]);
      // Still no second GetIndex yet — the failing write does not retry itself.
      expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);

      // The next write pays for one GetIndex again instead of trusting the cache.
      await store.addDocuments([doc()]);
      expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
    },
  );

  it('re-creates a missing index on the next write when createIndexIfNotExist is true', async () => {
    const { store, mock } = await primeCache();
    const notFound = Object.assign(new Error('gone'), { name: 'NotFoundException' });
    failNextPut(mock, notFound);
    await expect(store.addDocuments([doc()])).rejects.toMatchObject({
      context: { indexCacheInvalidated: true },
    });

    // Out-of-band deletion: GetIndex now reports the index missing.
    mock.on(GetIndexCommand).rejects(notFound);
    mock.on(CreateIndexCommand).resolves({});
    await store.addDocuments([doc()]);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('does not invalidate on an unrelated AWS failure (e.g. AccessDenied)', async () => {
    const { store, mock } = await primeCache();
    const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    failNextPut(mock, denied);

    const error = await store.addDocuments([doc()]).catch((e: unknown) => e);
    expect((error as S3VectorsError).context.indexCacheInvalidated).toBeUndefined();
    expect((error as S3VectorsError).message).not.toContain('cached index configuration');

    await store.addDocuments([doc()]);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('does not invalidate on an abort, or when nothing is cached yet', async () => {
    // Aborted: the cause is an AbortError, not an AWS exception.
    const primed = await primeCache();
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    failNextPut(primed.mock, abortError);
    const aborted = await primed.store.addDocuments([doc()]).catch((e: unknown) => e);
    expect((aborted as S3VectorsError).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((aborted as S3VectorsError).context.indexCacheInvalidated).toBeUndefined();

    // Nothing cached: createIndexIfNotExist: false against a missing index
    // fails at PutVectors with NotFound, but there is no stale cache to blame.
    const { client, mock } = createMockClient();
    const notFound = Object.assign(new Error('gone'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFound);
    mock.on(PutVectorsCommand).rejects(notFound);
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      createIndexIfNotExist: false,
    });
    const error = await store.addDocuments([doc()]).catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect((error as S3VectorsError).context.indexCacheInvalidated).toBeUndefined();
    expect((error as S3VectorsError).message).not.toContain('cached index configuration');
  });
});

describe('F5 — addDocuments pipelines embedding against in-flight PutVectors calls', () => {
  function gatedPuts(mock: ReturnType<typeof createMockClient>['mock']) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlightKeys: string[] = [];
    mock.on(PutVectorsCommand).callsFake(async (input) => {
      const key = input.vectors?.[0]?.key as string;
      if (key === 'id-0') return {}; // the serial first batch is never gated
      inFlightKeys.push(key);
      await gate;
      return {};
    });
    return { release: () => release(), inFlightKeys };
  }

  function countingEmbeddings(): { embeddings: EmbeddingsInterface; calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      embeddings: {
        embedDocuments: async (texts: string[]) => {
          calls += 1;
          return texts.map(() => [1, 2, 3]);
        },
        embedQuery: async () => [1, 2, 3],
      },
    };
  }

  it('embeds the next batch while the previous batch PutVectors is still in flight', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const { release, inFlightKeys } = gatedPuts(mock);
    const { embeddings, calls } = countingEmbeddings();
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = Array.from({ length: 4 }, (_, i) => new Document({ pageContent: `d-${i}` }));
    const ids = docs.map((_, i) => `id-${i}`);

    const pending = store.addDocuments(docs, { ids, batchSize: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Every put after the first is blocked, yet every batch has already been
    // embedded — a strict embed-then-await-put loop would be stuck at 2.
    expect(calls()).toBe(4);
    expect(inFlightKeys).toEqual(['id-1', 'id-2', 'id-3']);

    release();
    await expect(pending).resolves.toEqual(ids);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(4);
  });

  it('pauses embedding once maxConcurrentBatchCalls puts are in flight, and resumes as they settle', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const { release, inFlightKeys } = gatedPuts(mock);
    const { embeddings, calls } = countingEmbeddings();
    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
      maxConcurrentBatchCalls: 2,
    });
    const docs = Array.from({ length: 10 }, (_, i) => new Document({ pageContent: `d-${i}` }));
    const ids = docs.map((_, i) => `id-${i}`);

    const pending = store.addDocuments(docs, { ids, batchSize: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Batch 0 (serial) + a full window of 2: embedding has stopped at 3 and
    // stays there while the window is full — no unbounded run-ahead.
    expect(calls()).toBe(3);
    expect(inFlightKeys).toEqual(['id-1', 'id-2']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls()).toBe(3);

    release();
    await expect(pending).resolves.toEqual(ids);
    expect(calls()).toBe(10);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(10);
  });

  it('still never calls embedDocuments concurrently', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).callsFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      return {};
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = Array.from({ length: 12 }, (_, i) => new Document({ pageContent: `d-${i}` }));
    await store.addDocuments(docs, { batchSize: 1 });
    expect(maxInFlight).toBe(1);
  });

  it('does not start a PutVectors call for a batch whose embedding finished after the abort fired', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const controller = new AbortController();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 2) controller.abort();
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = Array.from({ length: 3 }, (_, i) => new Document({ pageContent: `d-${i}` }));

    const error = await store
      .addDocuments(docs, { batchSize: 1, signal: controller.signal })
      .catch((e: unknown) => e);

    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.ABORTED);
    // Only batch 0 was ever written — batch 1's embedding completed after
    // the signal fired, so its put must not have started.
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(embedCalls).toBe(2);
  });
});

describe('F7 — write ids must be unique, non-empty strings', () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => new Document({ pageContent: `d-${i}` }));

  it('rejects an empty-string id in options.ids before any AWS call', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const error = await store.addDocuments(docs(2), { ids: ['ok', ''] }).catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('index 1');
    expect((error as Error).message).toContain('an empty string');
    expect((error as Error).message).toContain('options.ids');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });

  it('rejects an empty-string Document.id instead of silently minting a UUID for it', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const withEmptyId = new Document({ pageContent: 'x', id: '' });
    const error = await store.addDocuments([withEmptyId]).catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain("documents' own `id` fields");
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('still generates a UUID for a document with no id at all', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const [id] = await store.addDocuments([new Document({ pageContent: 'x' })]);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects a non-string id that slipped past the type system', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const error = await store
      .addVectors([[1, 2, 3]], docs(1), { ids: [42 as unknown as string] })
      .catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('a number');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a duplicate id within a single call (addDocuments and addVectors)', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const viaDocs = await store
      .addDocuments(docs(3), { ids: ['a', 'b', 'a'] })
      .catch((e: unknown) => e);
    expect((viaDocs as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((viaDocs as Error).message).toContain('Duplicate vector id "a" at index 2');

    const viaVectors = await store
      .addVectors(
        [
          [1, 2, 3],
          [1, 2, 3],
        ],
        [
          new Document({ pageContent: 'x', id: 'same' }),
          new Document({ pageContent: 'y', id: 'same' }),
        ],
      )
      .catch((e: unknown) => e);
    expect((viaVectors as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((viaVectors as Error).message).toContain('Duplicate vector id "same"');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('still allows the same id across separate calls (an upsert)', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    await store.addDocuments(docs(1), { ids: ['same'] });
    await store.addDocuments(docs(1), { ids: ['same'] });
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(2);
  });
});

describe('F8 — encryptionConfiguration and tags are forwarded to CreateIndex', () => {
  it('forwards both when configured', async () => {
    const { client, mock } = createMockClient();
    mockIndexAutoCreated(mock);
    const encryptionConfiguration = {
      sseType: 'aws:kms' as const,
      kmsKeyArn: 'arn:aws:kms:us-east-1:111122223333:key/1234abcd',
    };
    const tags = { team: 'search', env: 'prod' };
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      encryptionConfiguration,
      tags,
    });
    expect(store.encryptionConfiguration).toBe(encryptionConfiguration);
    expect(store.tags).toBe(tags);

    await store.addDocuments([new Document({ pageContent: 'x' })]);
    const input = mock.commandCalls(CreateIndexCommand)[0]!.args[0].input;
    expect(input.encryptionConfiguration).toEqual(encryptionConfiguration);
    expect(input.tags).toEqual(tags);
  });

  it('omits both keys entirely when not configured', async () => {
    const { client, mock } = createMockClient();
    mockIndexAutoCreated(mock);
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await store.addDocuments([new Document({ pageContent: 'x' })]);
    const input = mock.commandCalls(CreateIndexCommand)[0]!.args[0].input;
    expect(Object.hasOwn(input, 'encryptionConfiguration')).toBe(false);
    expect(Object.hasOwn(input, 'tags')).toBe(false);
  });
});

describe('F9 — a plain filter object from another realm is accepted', () => {
  it('accepts an object literal created in a vm context', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    const foreign = runInNewContext('({ genre: "scifi" })') as Record<string, unknown>;
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 4, foreign)).resolves.toEqual([]);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.filter).toBe(foreign);
  });

  it('still rejects a class instance and a Map from another realm', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    const foreignInstance = runInNewContext('new (class Filter { genre = "x" })()') as never;
    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, foreignInstance),
    ).rejects.toThrow("which AWS's filter syntax does not accept");
    const foreignMap = runInNewContext('new Map([["genre", "x"]])') as never;
    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 4, foreignMap)).rejects.toThrow(
      "which AWS's filter syntax does not accept",
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });
});

describe('maxConcurrentBatchCalls option', () => {
  it('defaults to 10 and is validated as a positive integer', () => {
    const { client } = createMockClient();
    expect(new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client }).maxConcurrentBatchCalls).toBe(
      10,
    );
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let thrown: unknown;
      try {
        new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client, maxConcurrentBatchCalls: bad });
      } catch (error: unknown) {
        thrown = error;
      }
      expect(isS3VectorsError(thrown)).toBe(true);
      expect((thrown as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
      expect((thrown as Error).message).toContain('maxConcurrentBatchCalls');
    }
  });

  it('caps in-flight DeleteVectors and PutVectors calls at the configured value', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      maxConcurrentBatchCalls: 1,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const track = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return {};
    };
    mock.on(DeleteVectorsCommand).callsFake(track);
    mock.on(PutVectorsCommand).callsFake(track);

    const ids = Array.from({ length: 6 }, (_, i) => `id-${i}`);
    await store.delete({ ids, batchSize: 1 });
    await store.addVectors(
      ids.map(() => [1, 2, 3]),
      ids.map((id) => new Document({ pageContent: id })),
      { ids, batchSize: 1 },
    );
    expect(maxInFlight).toBe(1);
    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(6);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(6);
  });
});

describe('F12 — plain DocumentInterface objects are accepted by the write methods', () => {
  it('addDocuments / addVectors / fromDocuments take objects that are not Document instances', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    const plain = { pageContent: 'hello', metadata: { k: 'v' }, id: 'plain-1' };
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    await expect(store.addDocuments([plain])).resolves.toEqual(['plain-1']);
    await expect(store.addVectors([[1, 2, 3]], [plain])).resolves.toEqual(['plain-1']);
    await expect(
      AmazonS3Vectors.fromDocuments([plain], createMockEmbeddings(), { ...BASE_CONFIG, client }),
    ).resolves.toBeInstanceOf(AmazonS3Vectors);

    const written = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors?.[0];
    expect(written).toMatchObject({
      key: 'plain-1',
      metadata: { k: 'v', _page_content: 'hello' },
    });
  });
});
