import { CreateIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockIndexAutoCreated,
  mockIndexNotFound,
} from './helpers.js';

const TEN_KEYS = Array.from({ length: 10 }, (_, i) => `key_${i}`);

describe('AmazonS3Vectors auto-index nonFilterableMetadataKeys behavior', () => {
  it.each([
    {
      name: 'merges an explicitly configured key with the auto-added page-content key',
      config: { nonFilterableMetadataKeys: ['large_field'] },
      expectedKeys: ['large_field', '_page_content'],
    },
    {
      name: 'adds the default page-content key when none are configured',
      config: {},
      expectedKeys: ['_page_content'],
    },
    {
      name: 'adds nothing when pageContentMetadataKey is null and no other keys are set',
      config: { pageContentMetadataKey: null },
      expectedKeys: null,
    },
    {
      name: 'does not duplicate the key when the caller already listed it explicitly',
      config: { nonFilterableMetadataKeys: ['_page_content'] },
      expectedKeys: ['_page_content'],
    },
    {
      name: 'does not exceed the 10-key cap, falling back to the configured list unchanged',
      config: { nonFilterableMetadataKeys: TEN_KEYS },
      expectedKeys: TEN_KEYS,
    },
  ])('$name', async ({ config, expectedKeys }) => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      ...config,
      client,
    });

    mockIndexAutoCreated(mock);

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], {
      ids: ['id-1'],
    });

    const createCalls = mock.commandCalls(CreateIndexCommand);
    expect(createCalls).toHaveLength(1);
    const metadataConfiguration = createCalls[0]!.args[0].input.metadataConfiguration;

    if (expectedKeys === null) {
      expect(metadataConfiguration).toBeUndefined();
    } else {
      expect(new Set(metadataConfiguration?.nonFilterableMetadataKeys)).toEqual(
        new Set(expectedKeys),
      );
    }
  });
});

describe('AmazonS3Vectors metadata collision is checked before index creation', () => {
  it('does not call CreateIndex when the first batch has a colliding metadata key', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);
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
