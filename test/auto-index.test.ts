import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors auto-index with nonFilterableMetadataKeys', () => {
  it('passes metadataConfiguration to CreateIndex', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      nonFilterableMetadataKeys: ['large_field'],
    });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    const createCalls = mock.commandCalls(CreateIndexCommand);
    expect(createCalls).toHaveLength(1);
    const keys =
      createCalls[0]!.args[0].input.metadataConfiguration?.nonFilterableMetadataKeys ?? [];
    expect(new Set(keys)).toEqual(new Set(['large_field', '_page_content']));
  });
});

describe('AmazonS3Vectors auto-index default pageContentMetadataKey handling', () => {
  it('adds the default page-content key to nonFilterableMetadataKeys when none are configured', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    const createCalls = mock.commandCalls(CreateIndexCommand);
    expect(createCalls[0]!.args[0].input.metadataConfiguration).toEqual({
      nonFilterableMetadataKeys: ['_page_content'],
    });
  });

  it('does not add a metadataConfiguration when pageContentMetadataKey is null and no other keys are set', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      pageContentMetadataKey: null,
    });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    expect(
      mock.commandCalls(CreateIndexCommand)[0]!.args[0].input.metadataConfiguration,
    ).toBeUndefined();
  });

  it('does not duplicate the key when the caller already listed it explicitly', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      nonFilterableMetadataKeys: ['_page_content'],
    });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    expect(mock.commandCalls(CreateIndexCommand)[0]!.args[0].input.metadataConfiguration).toEqual({
      nonFilterableMetadataKeys: ['_page_content'],
    });
  });
});
