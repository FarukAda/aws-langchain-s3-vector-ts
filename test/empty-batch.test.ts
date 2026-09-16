import { describe, it, expect, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockExistingIndex,
  mockIndexNotFound,
} from './helpers.js';

describe('AmazonS3Vectors empty-batch dimension guard', () => {
  it('throws a precise error when embeddings yield no vectors for a non-empty batch of documents', async () => {
    const { client, mock } = createMockClient();
    mockIndexNotFound(mock);

    const emptyEmbeddings: EmbeddingsInterface = {
      embedDocuments: jest.fn(async () => []),
      embedQuery: jest.fn(async () => []),
    };

    const store = new AmazonS3Vectors(emptyEmbeddings, { ...BASE_CONFIG, client });

    // Caught by the embedDocuments count check, not the empty-vector guard
    // below — "0 vectors for 1 documents" is the actual root cause here,
    // not an ambiguous vector, and names it precisely instead of reporting
    // a symptom ("Cannot determine this batch's vector dimension")
    // that would also fire for the genuinely-different scenario the
    // second test below covers.
    await expect(
      store.addDocuments([new Document({ pageContent: 'orphan' })], { ids: ['id-1'] }),
    ).rejects.toThrow(
      'Embeddings model returned 0 vectors for 1 documents — it must return exactly one ' +
        'vector per document.',
    );
  });

  it('names addDocuments, since that is the call the mismatch happened inside', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async () => [],
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })])
      .catch((e: unknown) => e);
    expect((error as { context: { operation: string } }).context.operation).toBe('addDocuments');
  });

  it('throws when the first vector is an empty array (not just absent)', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);

    // The only reachable trigger for this guard is a vector that is itself
    // `[]` — a one-item batch, not an empty one. The message must not call
    // that an "empty batch", which misattributes the actual cause.
    await expect(
      store.addVectors([[]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('Every vector must have at least one dimension');
  });
});
