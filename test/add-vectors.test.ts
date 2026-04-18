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
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

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
    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

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
    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const docs = [new Document({ pageContent: 'doc1' })];
    const vectors = [[1, 2, 3]];

    const ids = await store.addVectors(vectors, docs);

    expect(ids).toHaveLength(1);
    // UUID without dashes = 32 hex characters
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('batches vectors correctly (batch size 2)', async () => {
    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

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
    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

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
    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

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

  it('rethrows non-NotFound errors when checking for existing index', async () => {
    const awsError = Object.assign(new Error('access denied'), { name: 'AccessDenied' });
    mock.on(GetIndexCommand).rejects(awsError);

    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['id-1'] }),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
