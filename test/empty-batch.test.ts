import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

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

  it('throws when the first vector is an empty array (not just absent)', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);

    await expect(
      store.addVectors([[]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('Cannot determine vector dimension from empty batch');
  });
});
