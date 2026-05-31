import {
  DeleteVectorsCommand,
  GetIndexCommand,
  GetVectorsCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors default batch boundaries', () => {
  it('splits addVectors into PutVectors batches of 200', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const count = 250;
    const vectors = Array.from({ length: count }, () => [1, 2, 3]);
    const docs = Array.from({ length: count }, (_, i) => new Document({ pageContent: `d-${i}` }));
    const ids = Array.from({ length: count }, (_, i) => `id-${i}`);

    await store.addVectors(vectors, docs, { ids });

    const calls = mock.commandCalls(PutVectorsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.vectors).toHaveLength(200);
    expect(calls[1]!.args[0].input.vectors).toHaveLength(50);
  });

  it('splits getByIds into GetVectors batches of 100', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetVectorsCommand).callsFake((input) => ({
      vectors: (input.keys ?? []).map((k: string) => ({ key: k, metadata: { _page_content: k } })),
    }));

    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const docs = await store.getByIds(ids);

    expect(docs).toHaveLength(250);
    expect(docs[0]!.id).toBe('id-0');
    expect(docs[249]!.id).toBe('id-249');
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(3);
  });

  it('splits delete into DeleteVectors batches of 500', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteVectorsCommand).resolves({});

    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    await store.delete({ ids });

    const calls = mock.commandCalls(DeleteVectorsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.keys).toHaveLength(500);
    expect(calls[1]!.args[0].input.keys).toHaveLength(1);
  });
});
