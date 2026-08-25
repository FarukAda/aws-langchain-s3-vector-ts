import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createTestStore, mockExistingIndex } from './helpers.js';

describe('AmazonS3Vectors.addDocuments', () => {
  it('embeds documents and calls addVectors', async () => {
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);

    const docs = [new Document({ pageContent: 'hello' })];
    const ids = await store.addDocuments(docs, { ids: ['doc-1'] });

    expect(ids).toEqual(['doc-1']);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello']);
  });
});

describe('AmazonS3Vectors.addDocuments input validation', () => {
  it('returns empty array for empty input', async () => {
    const { store } = createTestStore();

    const ids = await store.addDocuments([]);
    expect(ids).toEqual([]);
  });

  it('throws when ids count mismatches documents count', async () => {
    const { store } = createTestStore();

    await expect(
      store.addDocuments([new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })], {
        ids: ['only-one'],
      }),
    ).rejects.toThrow('Number of IDs (1) must match number of documents (2)');
  });
});

describe('AmazonS3Vectors.addDocuments per-batch embedding', () => {
  it('embeds documents per batch instead of all at once', async () => {
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    await store.addDocuments(docs, { batchSize: 2 });

    // embedDocuments should be called twice: once for ["a","b"], once for ["c"]
    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(2, ['c']);
  });
});

describe('AmazonS3Vectors.addDocuments without embeddings', () => {
  it('throws a coded S3VectorsError instead of a plain Error', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    try {
      await store.addDocuments([new Document({ pageContent: 'x' })]);
      throw new Error('should have thrown');
    } catch (error: unknown) {
      expect(isS3VectorsError(error)).toBe(true);
      expect((error as { code: S3VectorsErrorCode }).code).toBe(
        S3VectorsErrorCode.EMBEDDINGS_MISSING,
      );
    }
  });
});
