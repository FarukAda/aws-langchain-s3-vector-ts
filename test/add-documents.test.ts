import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.addDocuments', () => {
  it('embeds documents and calls addVectors', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const docs = [new Document({ pageContent: 'hello' })];
    const ids = await store.addDocuments(docs, { ids: ['doc-1'] });

    expect(ids).toEqual(['doc-1']);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello']);
  });
});

describe('AmazonS3Vectors.addDocuments input validation', () => {
  it('returns empty array for empty input', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    const ids = await store.addDocuments([]);
    expect(ids).toEqual([]);
  });

  it('throws when ids count mismatches documents count', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    await expect(
      store.addDocuments([new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })], {
        ids: ['only-one'],
      }),
    ).rejects.toThrow('Number of IDs (1) must match number of documents (2)');
  });
});

describe('AmazonS3Vectors.addDocuments per-batch embedding', () => {
  it('embeds documents per batch instead of all at once', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

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
