import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

describe('AmazonS3Vectors index compatibility validation', () => {
  it('rejects a write when the existing index has a different dimension', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 5, distanceMetric: 'cosine' },
    });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('dimension 5');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a write when the existing index uses a different distance metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      distanceMetric: 'cosine',
    });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'euclidean' },
    });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('euclidean');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('allows a write when the existing index matches dimension and metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('treats a GetIndex response with no index field as not-found', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({});
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });
});
