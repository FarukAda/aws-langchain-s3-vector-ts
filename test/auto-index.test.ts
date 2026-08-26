import { CreateIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockIndexAutoCreated,
  mockIndexNotFound,
} from './helpers.js';

const NINE_KEYS = Array.from({ length: 9 }, (_, i) => `key_${i}`);
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
      name: 'includes the page-content key when the configured list has exactly 9 keys (boundary: 10 total)',
      config: { nonFilterableMetadataKeys: NINE_KEYS },
      expectedKeys: [...NINE_KEYS, '_page_content'],
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

  it('throws instead of creating an index that would silently make page content filterable', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      nonFilterableMetadataKeys: TEN_KEYS,
      client,
    });

    mockIndexNotFound(mock);

    const error = await store
      .addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('10-key');
    // Must fail before ever calling AWS to create the (permanently
    // misconfigured) index — not create it and fail later at write time.
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });

  it('does not throw when nonFilterableMetadataKeys is at the 10-key cap and pageContentMetadataKey is null', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      nonFilterableMetadataKeys: TEN_KEYS,
      pageContentMetadataKey: null,
      client,
    });

    mockIndexAutoCreated(mock);

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    const createCalls = mock.commandCalls(CreateIndexCommand);
    expect(createCalls).toHaveLength(1);
    expect(
      new Set(createCalls[0]!.args[0].input.metadataConfiguration?.nonFilterableMetadataKeys),
    ).toEqual(new Set(TEN_KEYS));
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
