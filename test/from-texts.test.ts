import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.fromTexts', () => {
  it('creates instance, embeds, and stores texts', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const store = await AmazonS3Vectors.fromTexts(
      ['hello', 'world'],
      [{ genre: 'a' }, { genre: 'b' }],
      embeddings,
      { ...BASE_CONFIG, client },
    );

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello', 'world']);
  });
});

describe('AmazonS3Vectors.fromTexts metadata handling', () => {
  it('applies a single metadata object to every text', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    await AmazonS3Vectors.fromTexts(['a', 'b'], { shared: true }, embeddings, {
      ...BASE_CONFIG,
      client,
    });

    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input;
    expect(input.vectors?.[0]?.metadata).toMatchObject({ shared: true });
    expect(input.vectors?.[1]?.metadata).toMatchObject({ shared: true });
  });

  it('defaults to empty metadata when the array is shorter than texts', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    await AmazonS3Vectors.fromTexts(['a', 'b'], [{ only: 'first' }], embeddings, {
      ...BASE_CONFIG,
      client,
    });

    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input;
    expect(input.vectors?.[1]?.metadata).toEqual({ _page_content: 'b' });
  });
});
