import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.addTexts', () => {
  it('converts texts and metadatas into documents and stores them', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const ids = await store.addTexts(['hello', 'world'], [{ genre: 'a' }, { genre: 'b' }], {
      ids: ['t-1', 't-2'],
    });

    expect(ids).toEqual(['t-1', 't-2']);

    const putCalls = mock.commandCalls(PutVectorsCommand);
    expect(putCalls).toHaveLength(1);
    const input = putCalls[0]!.args[0].input;
    expect(input.vectors?.[0]?.metadata).toEqual({
      genre: 'a',
      _page_content: 'hello',
    });
    expect(input.vectors?.[1]?.metadata).toEqual({
      genre: 'b',
      _page_content: 'world',
    });
  });

  it('throws when metadatas count mismatches texts', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    await expect(store.addTexts(['a', 'b'], [{ x: 1 }])).rejects.toThrow('must match');
  });
});
