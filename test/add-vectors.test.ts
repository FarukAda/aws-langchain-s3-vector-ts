import {
  CreateIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
  type S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { AwsClientStub } from 'aws-sdk-client-mock';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  mockExistingIndex,
  mockIndexAutoCreated,
} from './helpers.js';

describe('AmazonS3Vectors.addVectors', () => {
  let store: AmazonS3Vectors;
  let client: S3VectorsClient;
  let mock: AwsClientStub<S3VectorsClient>;

  beforeEach(() => {
    ({ client, mock } = createMockClient());
    mock.reset();
    store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });
  });

  it('stores vectors with metadata and page_content', async () => {
    mockExistingIndex(mock);

    const docs = [new Document({ pageContent: 'hello world', metadata: { genre: 'test' } })];
    const vectors = [[0.1, 0.2, 0.3]];

    const ids = await store.addVectors(vectors, docs, {
      ids: ['id-1'],
    });

    expect(ids).toEqual(['id-1']);

    const putCalls = mock.commandCalls(PutVectorsCommand);
    expect(putCalls).toHaveLength(1);
    const input = putCalls[0]!.args[0].input;
    expect(input.vectors?.[0]?.key).toBe('id-1');
    expect(input.vectors?.[0]?.data).toEqual({ float32: [0.1, 0.2, 0.3] });
    expect(input.vectors?.[0]?.metadata).toEqual({
      genre: 'test',
      _page_content: 'hello world',
    });
  });

  it('generates UUID IDs when none provided', async () => {
    mockExistingIndex(mock);

    const docs = [new Document({ pageContent: 'doc1' })];
    const vectors = [[1, 2, 3]];

    const ids = await store.addVectors(vectors, docs);

    expect(ids).toHaveLength(1);
    // UUID without dashes = 32 hex characters
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('batches vectors correctly (batch size 2)', async () => {
    mockExistingIndex(mock);

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    await store.addVectors(vectors, docs, { batchSize: 2 });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    const putCalls = mock.commandCalls(PutVectorsCommand);
    expect(putCalls).toHaveLength(2);
    expect(putCalls[0]!.args[0].input.vectors).toHaveLength(2);
    expect(putCalls[1]!.args[0].input.vectors).toHaveLength(1);
  });

  it('auto-creates index when it does not exist', async () => {
    mockIndexAutoCreated(mock);

    const docs = [new Document({ pageContent: 'first' })];
    const vectors = [[1, 2, 3]];

    await store.addVectors(vectors, docs, { ids: ['id-1'] });

    const createCalls = mock.commandCalls(CreateIndexCommand);
    expect(createCalls).toHaveLength(1);
    const input = createCalls[0]!.args[0].input;
    expect(input.dimension).toBe(3);
    expect(input.distanceMetric).toBe('cosine');
    expect(input.dataType).toBe('float32');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('skips index creation when index exists', async () => {
    mockExistingIndex(mock);

    const docs = [new Document({ pageContent: 'exists' })];
    const vectors = [[1, 2, 3]];

    await store.addVectors(vectors, docs, { ids: ['id-1'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('throws when vector and document counts mismatch', async () => {
    await expect(
      store.addVectors(
        [[1, 2]],
        [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
      ),
    ).rejects.toThrow('must match');
  });

  it('rejects a non-array vectors argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .addVectors(null as any, [new Document({ pageContent: 'a' })])
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('vectors must be an array.');
  });

  it('rejects a non-array documents argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .addVectors([[1, 2, 3]], null as any)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('documents must be an array.');
  });

  it('returns empty array for empty input', async () => {
    const ids = await store.addVectors([], []);
    expect(ids).toEqual([]);
  });

  it('throws when ids count mismatches vectors count', async () => {
    await expect(
      store.addVectors(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
        { ids: ['only-one'] },
      ),
    ).rejects.toThrow('Number of IDs (1) must match number of vectors (2)');
  });

  it('throws for mismatched ids even when vectors and documents are both empty, instead of silently returning []', async () => {
    await expect(store.addVectors([], [], { ids: ['stale-id-1', 'stale-id-2'] })).rejects.toThrow(
      'Number of IDs (2) must match number of vectors (0)',
    );
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });

  it('never auto-creates when createIndexIfNotExist is false, but still validates against the existing index — once, cached', async () => {
    const localStore = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      createIndexIfNotExist: false,
    });
    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    mock.on(PutVectorsCommand).resolves({});

    await localStore.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
      ids: ['id-1'],
    });
    // A second write should reuse the cached validation, not re-fetch.
    await localStore.addVectors([[4, 5, 6]], [new Document({ pageContent: 'y' })], {
      ids: ['id-2'],
    });

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(2);
  });

  it('lets PutVectors fail naturally when createIndexIfNotExist is false and the index genuinely does not exist', async () => {
    const localStore = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      createIndexIfNotExist: false,
    });
    const notFound = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFound);
    mock
      .on(PutVectorsCommand)
      .rejects(Object.assign(new Error('no such index'), { name: 'NotFoundException' }));

    await expect(
      localStore.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow();

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('rejects a mismatched write against an existing index even when createIndexIfNotExist is false', async () => {
    const localStore = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      createIndexIfNotExist: false,
    });
    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 5, distanceMetric: 'cosine' },
    });

    await expect(
      localStore.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('dimension 5');

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rethrows non-NotFound errors when checking for existing index', async () => {
    const awsError = Object.assign(new Error('access denied'), { name: 'AccessDenied' });
    mock.on(GetIndexCommand).rejects(awsError);

    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['id-1'] }),
    ).rejects.toMatchObject({ name: 'S3VectorsError' });
  });
});

describe('addVectors — batch-internal dimension consistency', () => {
  it('rejects a batch whose vectors have inconsistent dimensions with INDEX_CONFIG_MISMATCH', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const error = await store
      .addVectors(
        [
          [1, 2, 3],
          [1, 2],
        ],
        [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
        { ids: ['id-1', 'id-2'] },
      )
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('index 1');
  });

  it('rejects an internally-inconsistent second batch with INDEX_CONFIG_MISMATCH, not a raw AWS error', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const error = await store
      .addVectors(
        [
          [1, 2, 3],
          [4, 5, 6],
          [1, 2, 3],
          [1, 2],
        ],
        [
          new Document({ pageContent: 'a' }),
          new Document({ pageContent: 'b' }),
          new Document({ pageContent: 'c' }),
          new Document({ pageContent: 'd' }),
        ],
        { ids: ['id-1', 'id-2', 'id-3', 'id-4'], batchSize: 2 },
      )
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('index 1');
    // Batch 0 (the first two vectors) already succeeded before batch 1 was
    // even validated — confirms this is genuinely testing the second
    // batch, not accidentally re-testing batch 0.
    expect((error as { context: { writtenIds: string[] } }).context.writtenIds).toEqual([
      'id-1',
      'id-2',
    ]);
  });
});
