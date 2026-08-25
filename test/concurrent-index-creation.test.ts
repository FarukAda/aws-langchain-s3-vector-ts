import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors concurrent index creation', () => {
  it('only calls CreateIndex once when two addDocuments calls race on a new index', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    let getIndexCalls = 0;
    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).callsFake(async () => {
      getIndexCalls += 1;
      throw notFoundError;
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await Promise.all([
      store.addDocuments([new Document({ pageContent: 'a' })], { ids: ['id-a'] }),
      store.addDocuments([new Document({ pageContent: 'b' })], { ids: ['id-b'] }),
    ]);

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
    expect(getIndexCalls).toBe(1);
  });

  it('tolerates a ConflictException from CreateIndex as a benign cross-process race', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    const conflictError = Object.assign(new Error('already exists'), { name: 'ConflictException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).rejects(conflictError);
    mock.on(PutVectorsCommand).resolves({});

    const ids = await store.addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] });
    expect(ids).toEqual(['id-1']);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('still surfaces a non-conflict CreateIndex failure', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    const deniedError = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).rejects(deniedError);

    await expect(
      store.addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('denied');
  });
});
