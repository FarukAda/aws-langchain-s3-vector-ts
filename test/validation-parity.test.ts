import { GetIndexCommand, PutVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings, indexFixture } from './helpers.js';

/**
 * A read validates what a write validates (F-18, F-19, F-27).
 *
 * The write path checks its ids and its vector components locally, before
 * spending anything. `delete` and the searches did not, so the same malformed
 * value was refused on one path and forwarded on another — and what AWS does
 * with it was never in doubt. Probed against the live service:
 *
 *     zero-norm query vector    REJECTED  Query vector contains invalid values or is invalid for this index
 *     empty query vector        REJECTED  (same)
 *     delete empty-string key   REJECTED  Member must have length between 1 and 1024
 *     delete duplicate keys     REJECTED  Request must not contain duplicate keys
 *
 * The last of those settles a question the audit got the wrong way round. It
 * recommended reusing the write path's id checks for `delete` "minus the
 * duplicate rule", on the reasoning that deleting a key twice is idempotent. It
 * is not: `DeleteVectors` refuses a request that repeats a key at all, so the
 * duplicate rule applies to `delete` exactly as it does to a write.
 */

function seeded(config = {}): { store: AmazonS3Vectors } {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).resolves({ index: indexFixture() });
  mock.on(PutVectorsCommand).resolves({});
  mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
  return {
    store: new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, ...config, client }),
  };
}

function failureOf(call: () => Promise<unknown>): Promise<S3VectorsError | undefined> {
  return call().then(
    () => undefined,
    (error: unknown) => {
      if (isS3VectorsError(error)) return error;
      throw error;
    },
  );
}

describe('delete validates its ids the way a write does', () => {
  it.each([
    ['null', [null]],
    ['an empty string', ['']],
    ['a number', [123]],
    ['an over-long key', ['x'.repeat(1025)]],
    ['a nested array', [['a']]],
    ['undefined', [undefined]],
  ])('refuses %s as a key, locally', async (_label, ids) => {
    const { store } = seeded();
    const error = await failureOf(async () => store.delete({ ids: ids as unknown as string[] }));
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('refuses a repeated key, which DeleteVectors itself refuses', async () => {
    const { store } = seeded();
    const error = await failureOf(async () => store.delete({ ids: ['same', 'same'] }));
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/duplicate/i);
  });

  it('still accepts a well-formed list, and an empty one', async () => {
    const { store } = seeded();
    await expect(store.delete({ ids: ['a', 'b'] })).resolves.toBeUndefined();
    await expect(store.delete({ ids: [] })).resolves.toBeUndefined();
  });
});

describe('a query vector is validated the way a stored vector is', () => {
  const vectorSearch = (store: AmazonS3Vectors, queryVector: unknown): Promise<unknown> =>
    store.similaritySearchVectorWithScore(queryVector as number[], 2);

  it.each([
    ['NaN', [0.1, Number.NaN, 0.3]],
    ['Infinity', [0.1, Number.POSITIVE_INFINITY, 0.3]],
    ['a string component', ['1', '2', '3']],
    ['a nested array', [[1], [2], [3]]],
    ['an empty vector', []],
  ])('refuses %s before the request', async (_label, queryVector) => {
    const { store } = seeded();
    const error = await failureOf(async () => vectorSearch(store, queryVector));
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('refuses a zero-norm query on a cosine index, which AWS rejects', async () => {
    const { store } = seeded();
    const error = await failureOf(async () => vectorSearch(store, [0, 0, 0]));
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/zero norm/i);
  });

  it('still accepts an ordinary query vector', async () => {
    const { store } = seeded();
    await expect(vectorSearch(store, [0.1, 0.2, 0.3])).resolves.toEqual([]);
  });
});

describe('untyped inputs to the factories are refused, not spread', () => {
  it('refuses a string where metadatas belongs', async () => {
    // `Array.isArray('str')` is false, so it was broadcast to every document and
    // then spread into `{0:'s',1:'t',2:'r'}` and written.
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await failureOf(async () =>
      AmazonS3Vectors.fromTexts(
        ['a'],
        'oops' as unknown as Record<string, unknown>,
        createMockEmbeddings(),
        {
          ...BASE_CONFIG,
          client,
        },
      ),
    );

    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/metadatas/i);
  });

  it('still broadcasts a single metadata object, which is documented', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    await expect(
      AmazonS3Vectors.fromTexts(['a', 'b'], { shared: 1 }, createMockEmbeddings(), {
        ...BASE_CONFIG,
        client,
      }),
    ).resolves.toBeInstanceOf(AmazonS3Vectors);
  });

  it('refuses a document whose pageContent is not a string', async () => {
    // It was stored as a number under the page-content key and read back as
    // `pageContent: ''`, with the number left in metadata.
    const { store } = seeded();
    const error = await failureOf(async () =>
      store.addVectors(
        [[0.1, 0.2, 0.3]],
        [{ pageContent: 123, metadata: {} } as unknown as Document],
      ),
    );
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/pageContent/);
  });

  it('refuses a document whose metadata is not an object', async () => {
    const { store } = seeded();
    const error = await failureOf(async () =>
      store.addVectors(
        [[0.1, 0.2, 0.3]],
        [{ pageContent: 'a', metadata: 'str' } as unknown as Document],
      ),
    );
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/metadata/);
  });

  it('refuses an options argument that is not an object', async () => {
    const { store } = seeded();
    const error = await failureOf(async () =>
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })], 0 as never),
    );
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('still accepts a missing options argument', async () => {
    const { store } = seeded();
    await expect(
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })]),
    ).resolves.toHaveLength(1);
  });
});

describe('fromTexts checks the two arguments its types cannot police', () => {
  function factoryFailure(texts: unknown, metadatas: unknown): Promise<S3VectorsError | undefined> {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    return failureOf(async () =>
      AmazonS3Vectors.fromTexts(
        texts as string[],
        metadatas as Record<string, unknown>,
        createMockEmbeddings(),
        { ...BASE_CONFIG, client },
      ),
    );
  }

  it('refuses a text that is not a string, naming its position', async () => {
    // It used to become `new Document({ pageContent: null })` and fail later as a
    // raw TypeError, from a frame that said nothing about `texts`.
    const error = await factoryFailure([null], undefined);
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toContain('texts[0]');
  });

  it('refuses a non-object inside the metadatas array, naming its position', async () => {
    const error = await factoryFailure(['a', 'b'], [{ ok: 1 }, 'oops']);
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toContain('metadatas[1]');
  });

  it('still allows a nullish entry, which becomes an empty metadata object', async () => {
    await expect(factoryFailure(['a', 'b'], [{ ok: 1 }, null])).resolves.toBeUndefined();
  });

  it('still reports a length mismatch', async () => {
    const error = await factoryFailure(['a', 'b'], [{ ok: 1 }]);
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/must match number of texts/);
  });
});
