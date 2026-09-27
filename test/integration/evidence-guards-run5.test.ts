import { randomUUID } from 'node:crypto';

import {
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { DocumentType } from '@smithy/types';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { requireLiveIntegrationEnv } from './_guard.js';

/**
 * One test per Tier 3 claim added in run 5 of `docs/evidence/`: how S3 Vectors
 * sizes metadata (T3-26), the byte bound on a vector key (T3-27), and what it
 * does with a component outside float32 (T3-28).
 *
 * Raw SDK, `maxAttempts: 1`, as with the other guards — except the one test
 * that writes through the store, whose subject is that the store now accepts
 * what the service does.
 */
const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — run 5 evidence guards (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const client = new S3VectorsClient({ region: safeEnv.region, maxAttempts: 1 });
  const setupClient = new S3VectorsClient({ region: safeEnv.region });
  const indexName = `run5-${randomUUID().slice(0, 8)}`;
  const target = { vectorBucketName: safeEnv.bucketName, indexName };
  const VECTOR = [0.1, 0.2, 0.3, 0.4];

  const put = async (
    key: string,
    metadata: Record<string, unknown>,
    data: number[] = VECTOR,
  ): Promise<string | undefined> => {
    try {
      await client.send(
        new PutVectorsCommand({
          ...target,
          vectors: [{ key, data: { float32: data }, metadata: metadata as DocumentType }],
        }),
      );
      return undefined;
    } catch (error: unknown) {
      return String((error as Error).message);
    }
  };

  beforeAll(async () => {
    await setupClient.send(
      new CreateIndexCommand({
        ...target,
        dataType: 'float32',
        dimension: 4,
        distanceMetric: 'cosine',
        metadataConfiguration: { nonFilterableMetadataKeys: ['nf'] },
      }),
    );
  });

  afterAll(async () => {
    await setupClient.send(new DeleteIndexCommand(target)).catch(() => undefined);
    client.destroy();
    setupClient.destroy();
  });

  describe('T3-26 — metadata is sized by type, not as JSON text', () => {
    const rep = (s: string, n: number): string => s.repeat(n);
    const numbered = (count: number, prefix: string, value: unknown): Record<string, unknown> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [prefix + String(i), value]));
    const padded = (count: number, prefix: string, value: unknown): Record<string, unknown> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [prefix + String(i).padStart(2, '0'), value]),
      );

    it.each<[string, (n: number) => Record<string, unknown>, number, string]>([
      ['newlines count once each', (n) => ({ f: rep('\n', n) }), 2035, '2048'],
      [
        'a number costs 4 bytes',
        (n) => ({ f: rep('x', n), ...numbered(10, 'i', 7) }),
        1895,
        '2048',
      ],
      [
        'an array element costs 4 bytes more than its value',
        (n) => ({ f: rep('x', n), a: Array.from({ length: 50 }, () => 1.5) }),
        1626,
        '2048',
      ],
      [
        'an entry costs 8 bytes',
        (n) => ({ f: rep('x', n), ...padded(19, 'k', 'y') }),
        1807,
        '2048',
      ],
      [
        'the 40 KB total follows the same rule',
        (n) => ({ nf: rep('x', n), ...padded(30, 'k', 'v') }),
        40586,
        '40960',
      ],
    ])(
      '%s: accepted at the model limit, refused one byte over',
      async (_label, gen, max, limit) => {
        expect(await put('m', gen(max))).toBeUndefined();
        expect(await put('m', gen(max + 1))).toContain(`at most ${limit} bytes`);
      },
    );

    it('lets the store write the text the old JSON count refused', async () => {
      const store = new AmazonS3Vectors(undefined, {
        ...target,
        region: safeEnv.region,
        createIndexIfNotExist: false,
        pageContentMetadataKey: null,
      });
      const text = rep('\n', 2035);
      await store.addVectors([VECTOR], [new Document({ pageContent: '', metadata: { f: text } })], {
        ids: ['store-newlines'],
      });
      const [found] = await store.getByIds(['store-newlines']);
      expect(found?.metadata['f']).toBe(text);
    });
  });

  describe('T3-27 — a vector key is at most 1,024 UTF-8 bytes', () => {
    it('accepts exactly 1,024 bytes of three-byte characters and refuses 1,025', async () => {
      expect(await put(`${'中'.repeat(340)}abcd`, {})).toBeUndefined();
      expect(await put(`${'中'.repeat(340)}abcde`, {})).toContain(
        'Record key length exceeds the maximum allowed',
      );
    });

    it('refuses a key over 1,024 bytes on GetVectors and DeleteVectors too', async () => {
      const key = '中'.repeat(342);
      for (const command of [
        new GetVectorsCommand({ ...target, keys: [key] }),
        new DeleteVectorsCommand({ ...target, keys: [key] }),
      ]) {
        const message = await client.send(command as never).then(
          () => undefined,
          (error: unknown) => String((error as Error).message),
        );
        expect(message).toContain('Record key length exceeds the maximum allowed');
      }
    });
  });

  describe('T3-28 — components are judged as float32', () => {
    it('refuses a finite double that rounds to Infinity, and keeps FLT_MAX', async () => {
      expect(await put('f', {}, [3.40282357e38, 1, 1, 1])).toContain('NaNs or Infs');
      expect(await put('f', {}, [3.4028235e38, 1, 1, 1])).toBeUndefined();
    });

    it('refuses a cosine vector whose components are all zero in float32', async () => {
      expect(await put('f', {}, [1e-46, 1e-46, 1e-46, 1e-46])).toContain('zero norm');
    });

    it('refuses the same overflow in a query vector', async () => {
      const message = await client
        .send(
          new QueryVectorsCommand({
            ...target,
            topK: 1,
            queryVector: { float32: [1e39, 1, 1, 1] },
          }),
        )
        .then(
          () => undefined,
          (error: unknown) => String((error as Error).message),
        );
      expect(message).toContain('Query vector contains invalid values');
    });
  });
}
