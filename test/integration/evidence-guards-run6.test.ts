import { randomUUID } from 'node:crypto';

import { CreateIndexCommand, DeleteIndexCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { afterAll, describe, expect, it } from '@jest/globals';

import { requireLiveIntegrationEnv } from './_guard.js';

/**
 * The Tier 3 claim added in run 6 of `docs/evidence/`: `CreateIndex` enforces
 * the tag rules this package applies before sending it (T3-29) — 50 tags, the
 * `aws:` prefix, and the character pattern.
 *
 * Raw SDK, `maxAttempts: 1`, as with the other guards. Every index a probe
 * creates is deleted again.
 */
const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — run 6 evidence guards (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const client = new S3VectorsClient({ region: safeEnv.region, maxAttempts: 1 });
  const setupClient = new S3VectorsClient({ region: safeEnv.region });
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];
  let sequence = 0;

  /** Create an index with these tags; `undefined` on success, else the service's message. */
  const createWithTags = async (tags: Record<string, string>): Promise<string | undefined> => {
    const indexName = `tags-${suffix}-${++sequence}`;
    try {
      await client.send(
        new CreateIndexCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName,
          dataType: 'float32',
          dimension: 4,
          distanceMetric: 'cosine',
          tags,
        }),
      );
      created.push(indexName);
      return undefined;
    } catch (error: unknown) {
      return String((error as Error).message);
    }
  };

  const numbered = (count: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 'v']));

  afterAll(async () => {
    for (const indexName of created) {
      await setupClient
        .send(new DeleteIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }))
        .catch(() => undefined);
    }
    client.destroy();
    setupClient.destroy();
  });

  describe('T3-29 — CreateIndex enforces its documented tag rules', () => {
    it('accepts 50 tags and refuses 51', async () => {
      expect(await createWithTags(numbered(50))).toBeUndefined();
      expect(await createWithTags(numbered(51))).toContain('Too many tags specified');
    });

    it('refuses a key under the aws: prefix', async () => {
      expect(await createWithTags({ 'aws:owner': 'x' })).toContain(
        'System tags cannot be added/updated by requester',
      );
    });

    it.each([
      ['an ampersand in a value', { team: 'search&ranking' }],
      ['a hash in a key', { 'cost#center': 'v' }],
      ['an emoji in a value', { team: 'k😀' }],
      ['a tab in a value', { team: 'a\tb' }],
    ])('refuses %s, quoting the documented pattern', async (_label, tags) => {
      expect(await createWithTags(tags)).toContain(
        'Member must satisfy regular expression pattern',
      );
    });

    it('accepts every character class the pattern admits, and an empty value', async () => {
      expect(
        await createWithTags({ 'Ünï cödé_.:/=+-@9': 'välue 1_.:/=+-@', 'k𝒜': '' }),
      ).toBeUndefined();
    });

    it('refuses an upper-case AWS: key too, which this package does not refuse', async () => {
      expect(await createWithTags({ 'AWS:owner': 'x' })).toContain(
        'must be prefixed with "aws:" in lowercase',
      );
    });
  });
}
