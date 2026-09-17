import { DeleteVectorsCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, mockExistingIndex } from './helpers.js';

/**
 * Eight concurrent `addVectors` on one store, with the defaults and no
 * limiter, failed every call with `THROTTLED` against live AWS. The cap that
 * existed — `maxConcurrentBatchCalls` — bounds one call's requests in flight,
 * not the store's rate, and AWS's limit is a rate
 * (`docs/evidence/write-rate.md`).
 */
const docs = (n: number): Document[] =>
  Array.from({ length: n }, (_, i) => new Document({ pageContent: `d-${i}` }));
const vectors = (n: number): number[][] => Array.from({ length: n }, () => [0.1, 0.2]);

describe('the write rate limit', () => {
  let client: ReturnType<typeof createMockClient>['client'];
  let mock: ReturnType<typeof createMockClient>['mock'];

  beforeEach(() => {
    ({ client, mock } = createMockClient());
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteVectorsCommand).resolves({});
  });

  it('paces writes against one budget shared by every call on the store', async () => {
    // 20 requests a second, so a burst of 20 goes at once and the rest waits.
    // One call of 12 is inside the burst; two of them together are not, which
    // is the whole point: the budget belongs to the store, not to the call.
    const limited = {
      ...BASE_CONFIG,
      client,
      writeRateLimit: { requestsPerSecond: 20, vectorsPerSecond: 100000 },
    };
    const single = new AmazonS3Vectors(undefined, limited);
    const startedSingle = Date.now();
    await single.addVectors(vectors(12), docs(12), { batchSize: 1 });
    const singleMs = Date.now() - startedSingle;

    const shared = new AmazonS3Vectors(undefined, limited);
    const startedPair = Date.now();
    await Promise.all([
      shared.addVectors(vectors(12), docs(12), { batchSize: 1 }),
      shared.addVectors(vectors(12), docs(12), { batchSize: 1 }),
    ]);
    const pairMs = Date.now() - startedPair;

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(36);
    expect(singleMs).toBeLessThan(100);
    expect(pairMs).toBeGreaterThanOrEqual(150);
  });

  it('paces deletes from the same budget, as AWS counts them', async () => {
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      writeRateLimit: { requestsPerSecond: 20, vectorsPerSecond: 100000 },
    });
    const ids = Array.from({ length: 26 }, (_, i) => `id-${i}`);
    const started = Date.now();

    await store.delete({ ids, batchSize: 1 });

    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(26);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it('sends without waiting when the limit is turned off', async () => {
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      writeRateLimit: false,
    });
    const started = Date.now();

    await store.addVectors(vectors(8), docs(8), { batchSize: 1 });

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(8);
    expect(Date.now() - started).toBeLessThan(140);
  });

  it('refuses a rate that cannot pace anything, at construction', () => {
    const build = (writeRateLimit: unknown): S3VectorsError => {
      try {
        new AmazonS3Vectors(undefined, {
          ...BASE_CONFIG,
          client,
          writeRateLimit: writeRateLimit as never,
        });
      } catch (error: unknown) {
        return error as S3VectorsError;
      }
      throw new Error('expected a refusal');
    };

    expect(build({ vectorsPerSecond: 0 }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(build({ vectorsPerSecond: 0 }).message).toContain('writeRateLimit.vectorsPerSecond');
    expect(build({ requestsPerSecond: -1 }).message).toContain('writeRateLimit.requestsPerSecond');
    expect(build({ requestsPerSecond: Number.POSITIVE_INFINITY }).code).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
    expect(build(true).message).toContain('writeRateLimit');
    expect(build('fast').code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('keeps AWS’s own per-index limits when nothing is configured', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const started = Date.now();

    // Well inside 2,500 vectors and 1,000 requests a second: no pacing at all.
    await store.addVectors(vectors(100), docs(100), { batchSize: 50 });

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(140);
  });
});
