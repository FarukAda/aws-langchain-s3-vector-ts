import { randomUUID } from 'node:crypto';

import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  GetVectorsCommand,
  PutVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { DocumentType } from '@smithy/types';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { flattenMetadata } from '../../src/shared/flatten-metadata.js';
import { requireLiveIntegrationEnv } from './_guard.js';

/**
 * One test per Tier 3 claim added in run 3 of `docs/evidence/`: the request
 * payload limit, the metadata rules under a non-filterable key, the KMS
 * pairing, the creation race, and the write rate.
 *
 * As with the other guards, these probe the raw SDK — `maxAttempts: 1`, so no
 * retry can mask a response — except where the claim is about this package's
 * own dispatch, which is `write-rate.md` and is marked as such there.
 *
 * This file uploads about 40 MB for the payload boundary. That is the cost of
 * the claim; it is why the live tier is on demand.
 */
const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — run 3 evidence guards (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const client = new S3VectorsClient({ region: safeEnv.region, maxAttempts: 1 });
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];

  const createIndex = async (indexName: string, input: Record<string, unknown>): Promise<void> => {
    await client.send(
      new CreateIndexCommand({
        vectorBucketName: safeEnv.bucketName,
        indexName,
        dataType: 'float32',
        distanceMetric: 'cosine',
        ...input,
      } as never),
    );
    created.push(indexName);
  };

  interface AwsFailure {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  }

  const failureOf = async (run: () => Promise<unknown>): Promise<AwsFailure> => {
    try {
      await run();
      throw new Error('expected the request to fail, but it succeeded');
    } catch (error: unknown) {
      return error as AwsFailure;
    }
  };

  afterAll(async () => {
    for (const indexName of created) {
      await client
        .send(new DeleteIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }))
        .catch(() => undefined);
    }
    client.destroy();
  });

  describe('T3-20 — the request payload limit', () => {
    const indexName = `payload-${suffix}`;
    const DIM = 4096;
    const MIB = 1024 * 1024;

    beforeAll(async () => {
      await createIndex(indexName, {
        dimension: DIM,
        metadataConfiguration: { nonFilterableMetadataKeys: ['_page_content'] },
      });
    });

    /** A vectors list whose serialized request body is exactly `targetBytes`. */
    const bodyOf = (targetBytes: number, tag: string): unknown[] => {
      const data = Array.from({ length: DIM }, (_, i) => Math.sin(i * 0.37) * 0.05 + 0.001);
      const entry = (i: number, content: number): unknown => ({
        key: `${tag}-${i}`,
        data: { float32: data },
        metadata: { _page_content: 'x'.repeat(content) },
      });
      const size = (list: unknown[]): number =>
        Buffer.byteLength(
          JSON.stringify({
            vectors: list,
            vectorBucketName: safeEnv.bucketName,
            indexName,
          }),
          'utf8',
        );
      const vectors: unknown[] = [];
      while (
        size([...vectors, entry(vectors.length, 39000), entry(vectors.length + 1, 0)]) <=
        targetBytes
      ) {
        vectors.push(entry(vectors.length, 39000));
      }
      const remaining = targetBytes - size([...vectors, entry(vectors.length, 0)]);
      vectors.push(entry(vectors.length, remaining));
      expect(size(vectors)).toBe(targetBytes);
      return vectors;
    };

    it('accepts a body of exactly 20 MiB and refuses one byte more', async () => {
      const accepted = await client.send(
        new PutVectorsCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName,
          vectors: bodyOf(20 * MIB, 'at-limit') as never,
        }),
      );
      expect(accepted.$metadata.httpStatusCode).toBe(200);

      const failure = await failureOf(() =>
        client.send(
          new PutVectorsCommand({
            vectorBucketName: safeEnv.bucketName,
            indexName,
            vectors: bodyOf(20 * MIB + 1, 'over-limit') as never,
          }),
        ),
      );
      expect(failure.name).toBe('ValidationException');
      expect(failure.$metadata?.httpStatusCode).toBe(400);
      expect(failure.message).toContain('Request body exceeds max allowed size');
    }, 300000);
  });

  describe('T3-21 — metadata rules under a non-filterable key', () => {
    const indexName = `nonfilterable-${suffix}`;

    beforeAll(async () => {
      await createIndex(indexName, {
        dimension: 4,
        metadataConfiguration: { nonFilterableMetadataKeys: ['_page_content', 'blob'] },
      });
    });

    const put = (key: string, metadata: Record<string, unknown>): Promise<unknown> =>
      client.send(
        new PutVectorsCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName,
          vectors: [
            { key, data: { float32: [0.1, 0.2, 0.3, 0.4] }, metadata: metadata as DocumentType },
          ],
        }),
      );

    it('refuses a nested object under a non-filterable key, and stores its flattened form', async () => {
      // "Non-filterable" buys larger values, not richer types.
      const splitterShape = { source: 'a.txt', loc: { lines: { from: 1, to: 10 } } };
      const nested = await failureOf(() => put('nested', { blob: splitterShape.loc }));
      expect(nested.name).toBe('ValidationException');
      expect(nested.message).toContain('Metadata values must be strings, numbers, booleans');

      const empty = await failureOf(() => put('empty-array', { blob: [] }));
      expect(empty.message).toContain('Empty arrays are not allowed in metadata');
      const nulled = await failureOf(() => put('null-value', { blob: null }));
      expect(nulled.name).toBe('ValidationException');

      await put('flattened', flattenMetadata(splitterShape));
      const read = await client.send(
        new GetVectorsCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName,
          keys: ['flattened'],
          returnMetadata: true,
        }),
      );
      expect(read.vectors?.[0]?.metadata).toEqual({
        source: 'a.txt',
        'loc.lines.from': 1,
        'loc.lines.to': 10,
      });
    }, 120000);
  });

  describe('T3-22 — the KMS pairing', () => {
    const key = `arn:aws:kms:${safeEnv.region}:000000000000:key/00000000-0000-0000-0000-000000000000`;

    it('refuses a KMS key with AES256, and aws:kms without one', async () => {
      const withKey = await failureOf(() =>
        createIndex(`kms-aes-${suffix}`, {
          dimension: 4,
          encryptionConfiguration: { sseType: 'AES256', kmsKeyArn: key },
        }),
      );
      expect(withKey.name).toBe('ValidationException');
      expect(withKey.message).toContain('kmsKeyArn must not be specified when sseType is AES256');

      const withoutKey = await failureOf(() =>
        createIndex(`kms-none-${suffix}`, {
          dimension: 4,
          encryptionConfiguration: { sseType: 'aws:kms' },
        }),
      );
      expect(withoutKey.name).toBe('ValidationException');
      expect(withoutKey.message).toContain(
        'kmsKeyArn must be specified when sseType is set to aws:kms',
      );
    }, 120000);
  });

  describe('T3-23 — losing an index-creation race', () => {
    it('lets the loser read the winner’s configuration immediately', async () => {
      const indexName = `race-${suffix}`;
      const attempt = (keys: string[]): Promise<unknown> =>
        createIndex(indexName, {
          dimension: 4,
          metadataConfiguration: { nonFilterableMetadataKeys: keys },
        });

      const [first, second] = await Promise.allSettled([
        attempt(['_page_content']),
        attempt(['_page_content', 'other']),
      ]);
      const loserRejected = first.status === 'rejected' || second.status === 'rejected';
      expect(loserRejected).toBe(true);

      const described = await client.send(
        new GetIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }),
      );
      expect(described.index?.metadataConfiguration?.nonFilterableMetadataKeys).toBeDefined();
    }, 120000);
  });

  describe('T3-24 — the write rate', () => {
    it('keeps a burst inside the service’s limit with the default pacing', async () => {
      // 3,000 vectors through this package: the default limiter must hold the
      // burst inside AWS's per-index rate, so nothing comes back THROTTLED.
      const indexName = `rate-${suffix}`;
      const store = new AmazonS3Vectors(undefined, {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });
      created.push(indexName);
      const count = 3000;
      const vectors = Array.from({ length: count }, (_, i) => [
        Math.sin(i) + 1.5,
        Math.cos(i) + 1.5,
        0.5,
        0.25,
      ]);
      const documents = Array.from(
        { length: count },
        (_, i) => new Document({ pageContent: `d-${i}` }),
      );

      const ids = await store.addVectors(vectors, documents);

      expect(ids).toHaveLength(count);
    }, 300000);
  });
}
