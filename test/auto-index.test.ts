import { CreateIndexCommand, GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockIndexAutoCreated,
} from './helpers.js';

describe('AmazonS3Vectors auto-index with nonFilterableMetadataKeys', () => {
  it('passes metadataConfiguration to CreateIndex', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      nonFilterableMetadataKeys: ['large_field'],
    });

    mockIndexAutoCreated(mock);

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

    mockIndexAutoCreated(mock);

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

    mockIndexAutoCreated(mock);

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

    mockIndexAutoCreated(mock);

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    expect(mock.commandCalls(CreateIndexCommand)[0]!.args[0].input.metadataConfiguration).toEqual({
      nonFilterableMetadataKeys: ['_page_content'],
    });
  });

  it('does not exceed the 10-key cap by falling back to the configured list', async () => {
    const { client, mock } = createMockClient();
    const tenKeys = Array.from({ length: 10 }, (_, i) => `key_${i}`);
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      nonFilterableMetadataKeys: tenKeys,
    });

    mockIndexAutoCreated(mock);

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    expect(mock.commandCalls(CreateIndexCommand)[0]!.args[0].input.metadataConfiguration).toEqual({
      nonFilterableMetadataKeys: tenKeys,
    });
  });
});

describe('AmazonS3Vectors metadata collision is checked before index creation', () => {
  it('does not call CreateIndex when the first batch has a colliding metadata key', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFoundError);
    mock.on(CreateIndexCommand).resolves({});

    await expect(
      store.addVectors(
        [[1, 2]],
        [new Document({ pageContent: 'x', metadata: { _page_content: 'collides' } })],
        { ids: ['id-1'] },
      ),
    ).rejects.toThrow(/reserved key/);

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });
});
