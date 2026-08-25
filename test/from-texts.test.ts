import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

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

  it('throws when the metadata array is shorter than the texts array', async () => {
    const { client } = createMockClient();
    const embeddings = createMockEmbeddings();

    await expect(
      AmazonS3Vectors.fromTexts(['a', 'b'], [{ only: 'first' }], embeddings, {
        ...BASE_CONFIG,
        client,
      }),
    ).rejects.toThrow('Number of metadatas (1) must match number of texts (2)');
  });
});

describe('AmazonS3Vectors.fromDocuments batchSize forwarding', () => {
  it('forwards batchSize to the underlying addDocuments call', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    await AmazonS3Vectors.fromDocuments(docs, embeddings, { ...BASE_CONFIG, client, batchSize: 2 });

    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(2, ['c']);
  });
});
