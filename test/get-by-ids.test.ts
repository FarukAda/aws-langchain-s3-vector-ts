import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.getByIds', () => {
  it('retrieves documents in input order', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetVectorsCommand).resolves({
      vectors: [
        { key: 'id-2', metadata: { _page_content: 'second' } },
        { key: 'id-1', metadata: { _page_content: 'first' } },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-2']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('first');
    expect(docs[0]!.id).toBe('id-1');
    expect(docs[1]!.pageContent).toBe('second');
    expect(docs[1]!.id).toBe('id-2');
  });

  it('throws when an ID is not found', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetVectorsCommand).resolves({ vectors: [] });

    await expect(store.getByIds(['missing-id'])).rejects.toThrow(
      "Id 'missing-id' not found in vector store.",
    );
  });
});

describe('AmazonS3Vectors.getByIds with duplicate IDs', () => {
  it('returns independent metadata for duplicate IDs', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetVectorsCommand).resolves({
      vectors: [
        {
          key: 'id-1',
          metadata: {
            _page_content: 'hello',
            nested: { value: 'original' },
          },
        },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-1']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('hello');
    expect(docs[1]!.pageContent).toBe('hello');

    // Mutating one document's metadata must not affect the other.
    (docs[0]!.metadata['nested'] as Record<string, string>).value = 'mutated';
    expect((docs[1]!.metadata['nested'] as Record<string, string>).value).toBe('original');
  });
});
