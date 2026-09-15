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

import { requireLiveIntegrationEnv } from './_guard.js';

/**
 * One test per Tier 3 claim in `docs/evidence/`.
 *
 * A Tier 3 claim is a behaviour AWS does not document, which this package
 * nevertheless relies on. The rule is that such a claim is citable only when
 * both exist: the evidence file recording the probe, and a named test here
 * asserting the same fact — so the live run fails if AWS ever changes it. The
 * file alone goes stale silently; the test alone cannot be checked by a
 * reviewer without AWS credentials.
 *
 * These probe the raw SDK rather than this package, exactly as the evidence
 * runs did, so nothing in `src/` can colour the answers. `maxAttempts: 1` for
 * the same reason: no retry may mask a response.
 */
const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — Tier 3 evidence guards (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const DIM = 4;
  const indexName = `evidence-${randomUUID().slice(0, 8)}`;
  const client = new S3VectorsClient({ region: safeEnv.region, maxAttempts: 1 });
  const scope = { vectorBucketName: safeEnv.bucketName, indexName };

  /** The error shape every probe below reads, without asserting on a class. */
  interface AwsFailure {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    fieldList?: { path?: string; message?: string }[];
  }

  const failureOf = async (run: () => Promise<unknown>): Promise<AwsFailure> => {
    try {
      await run();
      throw new Error('expected the request to fail, but it succeeded');
    } catch (error: unknown) {
      return error as AwsFailure;
    }
  };

  describe('live AWS — Tier 3 evidence guards', () => {
    beforeAll(async () => {
      await client.send(
        new CreateIndexCommand({
          ...scope,
          dataType: 'float32',
          dimension: DIM,
          distanceMetric: 'cosine',
          metadataConfiguration: { nonFilterableMetadataKeys: ['bulk'] },
        }),
      );
      await client.send(
        new PutVectorsCommand({
          ...scope,
          vectors: [
            { key: 'same', data: { float32: [1, 0, 0, 0] }, metadata: { g: 'a' } },
            { key: 'scaled', data: { float32: [5, 0, 0, 0] }, metadata: { g: 'a' } },
            { key: 'orth', data: { float32: [0, 1, 0, 0] }, metadata: { g: 'a' } },
            { key: 'opp', data: { float32: [-1, 0, 0, 0] }, metadata: { g: 'a' } },
          ],
        }),
      );
    }, 180_000);

    afterAll(async () => {
      try {
        await client.send(new DeleteIndexCommand(scope));
      } catch {
        // Teardown is best-effort: a failed create leaves nothing to delete.
      }
      client.destroy();
    }, 120_000);

    // ── T3-5 — docs/evidence/cosine-distance.md ─────────────────────────

    it('T3-5: cosine distance is 1 − cosine similarity, over the range [0, 2]', async () => {
      const response = await client.send(
        new QueryVectorsCommand({
          ...scope,
          topK: 4,
          queryVector: { float32: [1, 0, 0, 0] },
          returnDistance: true,
          returnMetadata: false,
        }),
      );
      const byKey = new Map(
        (response.vectors ?? []).map((vector) => [vector.key, vector.distance]),
      );
      expect(response.distanceMetric).toBe('cosine');
      expect(byKey.get('same')).toBeCloseTo(0, 5);
      // Magnitude-independent: this is cosine similarity, not an inner product.
      expect(byKey.get('scaled')).toBeCloseTo(0, 5);
      expect(byKey.get('orth')).toBeCloseTo(1, 5);
      expect(byKey.get('opp')).toBeCloseTo(2, 5);
    }, 120_000);

    // ── T3-7 — docs/evidence/get-vectors-absent-keys.md ─────────────────

    it('T3-7: GetVectors omits absent keys instead of failing', async () => {
      const mixed = await client.send(
        new GetVectorsCommand({
          ...scope,
          keys: ['same', 'does-not-exist', 'orth'],
          returnMetadata: true,
        }),
      );
      expect((mixed.vectors ?? []).map((v) => v.key).sort()).toEqual(['orth', 'same']);

      const none = await client.send(
        new GetVectorsCommand({ ...scope, keys: ['nope-1', 'nope-2'], returnMetadata: true }),
      );
      expect(none.vectors ?? []).toEqual([]);
    }, 120_000);

    // ── T3-8 — docs/evidence/delete-absent.md ──────────────────────────

    it('T3-8: DeleteVectors accepts keys that were never stored', async () => {
      const response = await client.send(
        new DeleteVectorsCommand({ ...scope, keys: ['never-existed-1', 'never-existed-2'] }),
      );
      expect(response.$metadata.httpStatusCode).toBe(200);
    }, 120_000);

    // ── T3-2 — docs/evidence/delete-absent.md ──────────────────────────

    it('T3-2: DeleteIndex on an index that does not exist is a 404, not a success', async () => {
      const failure = await failureOf(() =>
        client.send(
          new DeleteIndexCommand({
            vectorBucketName: safeEnv.bucketName,
            indexName: `absent-${randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      expect(failure.name).toBe('NotFoundException');
      expect(failure.$metadata?.httpStatusCode).toBe(404);
    }, 120_000);

    // ── T3-10 — docs/evidence/zero-vector.md ───────────────────────────

    it('T3-10: a zero vector is rejected on a cosine index, on write and on query', async () => {
      const write = await failureOf(() =>
        client.send(
          new PutVectorsCommand({
            ...scope,
            vectors: [{ key: 'zero', data: { float32: [0, 0, 0, 0] } }],
          }),
        ),
      );
      expect(write.name).toBe('ValidationException');
      expect(write.message).toContain('zero norm');

      const query = await failureOf(() =>
        client.send(
          new QueryVectorsCommand({
            ...scope,
            topK: 1,
            queryVector: { float32: [0, 0, 0, 0] },
            returnDistance: true,
          }),
        ),
      );
      expect(query.name).toBe('ValidationException');
    }, 120_000);

    // ── T3-9 — docs/evidence/metadata-value-types.md ───────────────────

    it('T3-9: a nested object in metadata is rejected', async () => {
      const failure = await failureOf(() =>
        client.send(
          new PutVectorsCommand({
            ...scope,
            vectors: [
              { key: 'nested', data: { float32: [1, 0, 0, 0] }, metadata: { obj: { a: 1 } } },
            ],
          }),
        ),
      );
      expect(failure.name).toBe('ValidationException');
      expect(failure.message).toContain('Metadata values must be');
    }, 120_000);

    it('T3-9: an array of objects in metadata is rejected', async () => {
      const failure = await failureOf(() =>
        client.send(
          new PutVectorsCommand({
            ...scope,
            vectors: [
              { key: 'nested2', data: { float32: [1, 0, 0, 0] }, metadata: { arr: [{ a: 1 }] } },
            ],
          }),
        ),
      );
      expect(failure.name).toBe('ValidationException');
      expect(failure.message).toContain('Metadata array values must be');
    }, 120_000);

    // ── T3-4 — docs/evidence/metadata-limits.md ────────────────────────

    it('T3-4: the filterable limit is counted over serialised JSON bytes plus five', async () => {
      // `{"f":"x"×n}` serialises to n + 8 bytes; the evidence run accepted
      // 2035 and rejected 2036, which is the documented 2048 less five.
      const put = (length: number): Promise<unknown> =>
        client.send(
          new PutVectorsCommand({
            ...scope,
            vectors: [
              {
                key: 'probe',
                data: { float32: [1, 0, 0, 0] },
                metadata: { f: 'x'.repeat(length) },
              },
            ],
          }),
        );

      await expect(put(2035)).resolves.toBeDefined();
      const failure = await failureOf(() => put(2036));
      expect(failure.name).toBe('ValidationException');
      expect(failure.message).toContain('2048 bytes');
    }, 180_000);

    it('T3-4: the total limit applies to a non-filterable key, on the same rule', async () => {
      const put = (length: number): Promise<unknown> =>
        client.send(
          new PutVectorsCommand({
            ...scope,
            vectors: [
              {
                key: 'bulk-probe',
                data: { float32: [1, 0, 0, 0] },
                metadata: { bulk: 'x'.repeat(length) },
              },
            ],
          }),
        );

      await expect(put(40_944)).resolves.toBeDefined();
      const failure = await failureOf(() => put(40_945));
      expect(failure.name).toBe('ValidationException');
      expect(failure.message).toContain('40960 bytes');
    }, 180_000);

    // ── T3-1 and T3-11 — docs/evidence/filter-validation.md ────────────

    it.each([
      ['T3-1: an empty filter object', {}],
      ['T3-11: a mistyped operator', { g: { $eg: 'a' } }],
      ['T3-11: an unknown $-prefixed key', { g: { $schema: 'https://example.com' } }],
      ['the documented non-empty rule for $in', { g: { $in: [] } }],
    ])(
      '%s is rejected by the service as an invalid filter',
      async (_label, filter) => {
        const failure = await failureOf(() =>
          client.send(
            new QueryVectorsCommand({
              ...scope,
              topK: 1,
              queryVector: { float32: [1, 0, 0, 0] },
              returnDistance: true,
              filter,
            }),
          ),
        );
        expect(failure.name).toBe('ValidationException');
        // AWS's entire diagnosis is this one string, identical for all four —
        // which is why this package validates filters locally and names the key.
        expect(failure.message).toContain('Invalid filter');
      },
      120_000,
    );
  });
}
