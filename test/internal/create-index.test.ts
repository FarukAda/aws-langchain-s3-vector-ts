import { CreateIndexCommand, GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import {
  createIndexLifecycle,
  nonFilterableKeys,
  type IndexLifecycleConfig,
} from '../../src/internal/index-lifecycle.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient } from '../helpers.js';

/**
 * One test per rule of `createIndex` (docs/CONTRACTS-DRAFT.md,
 * "internal/index-lifecycle"). An index's dimension, metric and non-filterable
 * keys are fixed at creation, so a rejected configuration must never reach
 * `CreateIndex`.
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function lifecycleWith(config: Partial<IndexLifecycleConfig> = {}) {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
  mock.on(CreateIndexCommand).resolves({});
  const lifecycle = createIndexLifecycle(
    { client, vectorBucketName: 'test-bucket', indexName: 'test-index' },
    {
      dataType: 'float32',
      distanceMetric: 'cosine',
      pageContentMetadataKey: '_page_content',
      ...config,
    },
  );
  return { mock, lifecycle };
}

const inputOf = (mock: ReturnType<typeof lifecycleWith>['mock']): Record<string, unknown> =>
  mock.commandCalls(CreateIndexCommand)[0]!.args[0].input as unknown as Record<string, unknown>;

describe('createIndexLifecycle — index creation rules', () => {
  describe('dimension', () => {
    it.each([0, -1, 4097, 1.5])('rejects %p before issuing CreateIndex', async (dimension) => {
      const { mock, lifecycle } = lifecycleWith();
      const error = await lifecycle.ensureExists(dimension).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    });

    it.each([1, 4096])('accepts the boundary %p', async (dimension) => {
      const { mock, lifecycle } = lifecycleWith();
      await lifecycle.ensureExists(dimension);
      expect(inputOf(mock)['dimension']).toBe(dimension);
    });
  });

  describe('non-filterable metadata keys', () => {
    it('adds the page-content key to the configured list', async () => {
      const { mock, lifecycle } = lifecycleWith({ nonFilterableMetadataKeys: ['bulk'] });
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['metadataConfiguration']).toEqual({
        nonFilterableMetadataKeys: ['bulk', '_page_content'],
      });
    });

    it('does not duplicate a page-content key the caller already listed', async () => {
      const { mock, lifecycle } = lifecycleWith({
        nonFilterableMetadataKeys: ['_page_content', 'bulk'],
      });
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['metadataConfiguration']).toEqual({
        nonFilterableMetadataKeys: ['_page_content', 'bulk'],
      });
    });

    it('sends no metadataConfiguration when there are no keys at all', async () => {
      const { mock, lifecycle } = lifecycleWith({ pageContentMetadataKey: null });
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['metadataConfiguration']).toBeUndefined();
    });

    it('rejects a merged list over the 10-key cap', async () => {
      const { mock, lifecycle } = lifecycleWith({
        nonFilterableMetadataKeys: Array.from({ length: 10 }, (_, i) => `k${i}`),
      });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    });

    it("rejects a caller's own list over the cap, even when no page-content key is added", async () => {
      const { mock, lifecycle } = lifecycleWith({
        pageContentMetadataKey: null,
        nonFilterableMetadataKeys: Array.from({ length: 11 }, (_, i) => `k${i}`),
      });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    });

    it.each([
      ['', 'empty'],
      ['x'.repeat(64), '64 characters'],
    ])('rejects a non-filterable key that is %s', async (key) => {
      const { mock, lifecycle } = lifecycleWith({ nonFilterableMetadataKeys: [key] });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    });

    it('accepts a non-filterable key at the 63-character boundary', async () => {
      const { lifecycle } = lifecycleWith({ nonFilterableMetadataKeys: ['x'.repeat(63)] });
      await expect(lifecycle.ensureExists(3)).resolves.toBeUndefined();
    });
  });

  describe('tags', () => {
    it('forwards tags when configured', async () => {
      const { mock, lifecycle } = lifecycleWith({ tags: { team: 'search' } });
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['tags']).toEqual({ team: 'search' });
    });

    it('omits tags when not configured', async () => {
      const { mock, lifecycle } = lifecycleWith();
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['tags']).toBeUndefined();
    });

    it('rejects a tag key over 128 characters', async () => {
      const { mock, lifecycle } = lifecycleWith({ tags: { ['x'.repeat(129)]: 'v' } });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
    });

    it('rejects an empty tag key', async () => {
      const { lifecycle } = lifecycleWith({ tags: { '': 'v' } });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    });

    it('rejects a tag value over 256 characters', async () => {
      const { lifecycle } = lifecycleWith({ tags: { k: 'x'.repeat(257) } });
      const error = await lifecycle.ensureExists(3).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    });

    it('accepts an empty tag value, which the documented minimum of 0 allows', async () => {
      const { lifecycle } = lifecycleWith({ tags: { k: '' } });
      await expect(lifecycle.ensureExists(3)).resolves.toBeUndefined();
    });
  });

  describe('encryption', () => {
    it('forwards encryptionConfiguration when configured', async () => {
      const { mock, lifecycle } = lifecycleWith({
        encryptionConfiguration: { sseType: 'AES256' },
      });
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['encryptionConfiguration']).toEqual({ sseType: 'AES256' });
    });

    it('omits encryptionConfiguration when not configured', async () => {
      const { mock, lifecycle } = lifecycleWith();
      await lifecycle.ensureExists(3);
      expect(inputOf(mock)['encryptionConfiguration']).toBeUndefined();
    });
  });

  describe('nonFilterableKeys', () => {
    it('does not mutate the array the caller configured the store with', () => {
      const configured = ['bulk'];
      const keys = nonFilterableKeys({
        dataType: 'float32',
        distanceMetric: 'cosine',
        pageContentMetadataKey: '_page_content',
        nonFilterableMetadataKeys: configured,
      });
      expect(keys).toEqual(['bulk', '_page_content']);
      // The store holds this array for its lifetime and hands it to every
      // later index creation; appending in place would grow it each time.
      expect(configured).toEqual(['bulk']);
    });

    it('adds nothing when page content is not stored at all', () => {
      expect(
        nonFilterableKeys({
          dataType: 'float32',
          distanceMetric: 'cosine',
          pageContentMetadataKey: null,
          nonFilterableMetadataKeys: ['bulk'],
        }),
      ).toEqual(['bulk']);
    });
  });
});
