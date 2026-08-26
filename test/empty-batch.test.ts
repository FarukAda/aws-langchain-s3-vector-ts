import { describe, it, expect, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockIndexNotFound,
} from './helpers.js';

describe('AmazonS3Vectors empty-batch dimension guard', () => {
  it('throws a precise error when embeddings yield no vectors for a non-empty batch of documents', async () => {
    const { client, mock } = createMockClient();
    mockIndexNotFound(mock);

    const emptyEmbeddings: EmbeddingsInterface = {
      embedDocuments: jest.fn(async () => []),
      embedQuery: jest.fn(async () => []),
    } as unknown as EmbeddingsInterface;

    const store = new AmazonS3Vectors(emptyEmbeddings, { ...BASE_CONFIG, client });

    // Caught by the embedDocuments count check, not the empty-vector guard
    // below — "0 vectors for 1 documents" is the actual root cause here,
    // not an ambiguous vector, and names it precisely instead of reporting
    // a symptom ("Cannot determine vector dimension from empty batch")
    // that would also fire for the genuinely-different scenario the
    // second test below covers.
    await expect(
      store.addDocuments([new Document({ pageContent: 'orphan' })], { ids: ['id-1'] }),
    ).rejects.toThrow('Embeddings model returned 0 vectors for 1 documents');
  });

  it('throws when the first vector is an empty array (not just absent)', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);

    await expect(
      store.addVectors([[]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('Cannot determine vector dimension from empty batch');
  });
});
