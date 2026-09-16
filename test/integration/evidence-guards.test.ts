import { randomUUID } from 'node:crypto';

import {
  CreateIndexCommand,
  type CreateIndexCommandInput,
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { DocumentType } from '@smithy/types';

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
            // `popular` is a boolean on purpose: T3-12 needs a stored type to
            // mismatch a filter value against. The vectors themselves are
            // untouched, so every distance assertion above stays valid.
            { key: 'same', data: { float32: [1, 0, 0, 0] }, metadata: { g: 'a', popular: true } },
            { key: 'scaled', data: { float32: [5, 0, 0, 0] }, metadata: { g: 'a', popular: true } },
            { key: 'orth', data: { float32: [0, 1, 0, 0] }, metadata: { g: 'a', popular: true } },
            { key: 'opp', data: { float32: [-1, 0, 0, 0] }, metadata: { g: 'a', popular: true } },
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

    // ── T3-12 and T3-13 — docs/evidence/filter-validation.md ───────

    it('T3-12: a type-mismatched comparison matches nothing, and is not an error', async () => {
      const query = async (filter: DocumentType): Promise<number> => {
        const response = await client.send(
          new QueryVectorsCommand({
            ...scope,
            topK: 4,
            queryVector: { float32: [1, 0, 0, 0] },
            returnDistance: true,
            filter,
          }),
        );
        return response.vectors?.length ?? 0;
      };

      // The control matters as much as the case: without it, a filter that
      // matched nothing for some unrelated reason would look like confirmation.
      expect(await query({ popular: { $eq: true } })).toBeGreaterThan(0);
      expect(await query({ popular: { $eq: 'true' } })).toBe(0);
      expect(await query({ absent: { $eq: 'x' } })).toBe(0);
    }, 120_000);

    it('T3-13: filtering on a non-filterable key is rejected, and says so', async () => {
      const failure = await failureOf(() =>
        client.send(
          new QueryVectorsCommand({
            ...scope,
            topK: 1,
            queryVector: { float32: [1, 0, 0, 0] },
            returnDistance: true,
            // `bulk` is this index's declared non-filterable key.
            filter: { bulk: { $eq: 'x' } },
          }),
        ),
      );
      expect(failure.name).toBe('ValidationException');
      expect(failure.message).toContain('non-filterable');
    }, 120_000);

    // ── Shared by the run-2 claims ───────────────────────────────────────

    const putOne = (key: string, metadata: DocumentType): Promise<unknown> =>
      client.send(
        new PutVectorsCommand({
          ...scope,
          vectors: [{ key, data: { float32: [1, 0, 0, 0] }, metadata }],
        }),
      );

    const queryWith = (filter: DocumentType): Promise<unknown> =>
      client.send(
        new QueryVectorsCommand({
          ...scope,
          topK: 1,
          queryVector: { float32: [1, 0, 0, 0] },
          returnDistance: true,
          filter,
        }),
      );

    // ── T3-14 — docs/evidence/metadata-value-types.md ──────────────────

    it.each<[string, DocumentType, string]>([
      ['nothing', { arr: [] }, 'Empty arrays are not allowed in metadata'],
      [
        'a number, then a string',
        { arr: [1, 'a'] },
        'Metadata array values must be strings or numbers',
      ],
      [
        'a string, then a number',
        { arr: ['a', 1] },
        'Metadata array values must be strings or numbers',
      ],
    ])(
      'T3-14: a metadata array holding %s is rejected',
      async (_label, metadata, message) => {
        const failure = await failureOf(() => putOne('t3-14', metadata));
        expect(failure.name).toBe('ValidationException');
        expect(failure.message).toContain(message);
      },
      120_000,
    );

    it('T3-14: single-type arrays, empty strings and repeated elements are accepted', async () => {
      const keys = ['t3-14-strings', 't3-14-numbers'];
      try {
        await expect(putOne(keys[0]!, { arr: ['', 'dup', 'dup'], s: '' })).resolves.toBeDefined();
        await expect(putOne(keys[1]!, { arr: [1, 2.5], n: -1.5 })).resolves.toBeDefined();
      } finally {
        // Removed again, so the four vectors the distance claims rely on stay the
        // only ones in the index.
        await client.send(new DeleteVectorsCommand({ ...scope, keys }));
      }
    }, 120_000);

    // ── T3-15 — docs/evidence/string-encoding.md ───────────────────────

    /** Half of a surrogate pair — what text cut by UTF-16 code unit leaves behind. */
    const LONE = 'x\ud800';

    const createWith = (
      extra: Pick<
        CreateIndexCommandInput,
        'tags' | 'metadataConfiguration' | 'encryptionConfiguration'
      >,
    ): Promise<unknown> =>
      client.send(
        new CreateIndexCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName: `enc-${randomUUID().slice(0, 8)}`,
          dataType: 'float32',
          dimension: DIM,
          distanceMetric: 'cosine',
          ...extra,
        }),
      );

    it.each<[string, () => Promise<unknown>]>([
      ['a metadata value', () => putOne('t3-15-value', { s: LONE })],
      ['a metadata value, as a low surrogate', () => putOne('t3-15-low', { s: '\udc00x' })],
      ['a metadata array element', () => putOne('t3-15-element', { arr: [LONE] })],
      ['a metadata key', () => putOne('t3-15-key', { [LONE]: 'x' })],
      ['a PutVectors key', () => putOne(LONE, { s: 'x' })],
      ['a GetVectors key', () => client.send(new GetVectorsCommand({ ...scope, keys: [LONE] }))],
      [
        'a DeleteVectors key',
        () => client.send(new DeleteVectorsCommand({ ...scope, keys: [LONE] })),
      ],
      ['a filter string', () => queryWith({ g: LONE })],
      ['an $in element', () => queryWith({ g: { $in: [LONE] } })],
      ['a CreateIndex tag key', () => createWith({ tags: { [LONE]: 'x' } })],
      ['a CreateIndex tag value', () => createWith({ tags: { team: LONE } })],
      [
        'a CreateIndex non-filterable key',
        () => createWith({ metadataConfiguration: { nonFilterableMetadataKeys: [LONE] } }),
      ],
      [
        'a CreateIndex KMS key ARN',
        () =>
          createWith({
            encryptionConfiguration: {
              sseType: 'aws:kms',
              kmsKeyArn: `arn:aws:kms:${safeEnv.region}:000000000000:key/${LONE}`,
            },
          }),
      ],
    ])(
      'T3-15: an unpaired surrogate in %s fails the whole request',
      async (_label, send) => {
        const failure = await failureOf(send);
        expect(failure.name).toBe('SerializationException');
        expect(failure.$metadata?.httpStatusCode).toBe(400);
      },
      120_000,
    );

    it('T3-15: a surrogate pair is accepted in the same positions', async () => {
      const PAIR = 'x😀';
      try {
        await expect(putOne(PAIR, { s: PAIR, arr: [PAIR] })).resolves.toBeDefined();
        await expect(queryWith({ s: PAIR })).resolves.toBeDefined();
      } finally {
        await client.send(new DeleteVectorsCommand({ ...scope, keys: [PAIR] }));
      }
    }, 120_000);

    // ── T3-16 — docs/evidence/filter-validation.md ─────────────────────

    it.each<[string, DocumentType]>([
      ['$eq holding null', { g: { $eq: null } }],
      ['$eq holding an array', { g: { $eq: ['a'] } }],
      ['$eq holding an object', { g: { $eq: {} } }],
      ['$ne holding null', { g: { $ne: null } }],
      ['$gt holding a string', { n: { $gt: '1' } }],
      ['$gte holding a boolean', { n: { $gte: true } }],
      ['$lt holding null', { n: { $lt: null } }],
      ['$lte holding an array', { n: { $lte: [1] } }],
      ['$in holding null', { g: { $in: [null] } }],
      ['$in holding an object', { g: { $in: [{}] } }],
      ['$in holding a nested array', { g: { $in: [['a']] } }],
      ['$nin holding null', { g: { $nin: [null] } }],
      ['$exists holding a string', { g: { $exists: 'yes' } }],
      ['$exists holding a number', { g: { $exists: 1 } }],
      ['a shorthand null', { g: null }],
      ['a shorthand array', { g: ['a'] }],
    ])(
      'T3-16: %s is rejected as an invalid filter',
      async (_label, filter) => {
        const failure = await failureOf(() => queryWith(filter));
        expect(failure.name).toBe('ValidationException');
        expect(failure.message).toContain('Invalid filter');
      },
      120_000,
    );

    it.each<[string, DocumentType]>([
      ['$eq holding a number', { n: { $eq: 1 } }],
      ['$ne holding a boolean', { popular: { $ne: false } }],
      ['$gt holding a fraction', { n: { $gt: 0.5 } }],
      ['$in holding booleans', { popular: { $in: [true] } }],
      ['$in holding mixed types', { g: { $in: ['a', 1] } }],
      ['$nin holding mixed types', { g: { $nin: ['z', 1] } }],
      ['$exists holding false', { absent: { $exists: false } }],
      ['a shorthand boolean', { popular: true }],
    ])(
      'T3-16: %s is accepted',
      async (_label, filter) => {
        await expect(queryWith(filter)).resolves.toBeDefined();
      },
      120_000,
    );

    // ── T3-17 — docs/evidence/filter-validation.md ─────────────────────

    it.each<[string, DocumentType]>([
      ['two fields', { g: 'a', popular: true }],
      ['two fields with operators', { g: { $eq: 'a' }, popular: { $eq: true } }],
      ['two fields inside an $and element', { $and: [{ g: 'a', popular: true }] }],
      ['a logical operator beside a field', { $and: [{ g: 'a' }], g: 'a' }],
      ['two logical operators', { $and: [{ g: 'a' }], $or: [{ popular: true }] }],
    ])(
      'T3-17: %s in one condition object is rejected',
      async (_label, filter) => {
        const failure = await failureOf(() => queryWith(filter));
        expect(failure.name).toBe('ValidationException');
        expect(failure.message).toContain('Invalid filter');
      },
      120_000,
    );

    it('T3-17: the same conditions combined with $and, and several operators on one field, are accepted', async () => {
      await expect(queryWith({ $and: [{ g: 'a' }, { popular: true }] })).resolves.toBeDefined();
      await expect(queryWith({ g: { $eq: 'a', $ne: 'b' } })).resolves.toBeDefined();
    }, 120_000);

    // ── T3-18 — docs/evidence/filter-validation.md ─────────────────────

    it.each<[string, DocumentType]>([
      ['an empty operator object', { g: {} }],
      ['a non-operator key', { g: { x: 1 } }],
      ['an operator beside a non-operator key', { g: { $eq: 'a', x: 1 } }],
      ['$and inside a field', { g: { $and: [{ g: 'a' }] } }],
      ['$or inside a field', { g: { $or: [{ g: 'a' }] } }],
      ['an empty object inside $and', { $and: [{}] }],
      ['a string inside $and', { $and: ['x'] }],
    ])(
      'T3-18: %s is rejected as an invalid filter',
      async (_label, filter) => {
        const failure = await failureOf(() => queryWith(filter));
        expect(failure.name).toBe('ValidationException');
        expect(failure.message).toContain('Invalid filter');
      },
      120_000,
    );

    // ── T3-19 — docs/evidence/filter-validation.md ─────────────────────

    it('T3-19: a non-finite number is sent as a string — accepted by $eq, $in and the shorthand, rejected by a range operator', async () => {
      await expect(queryWith({ g: Number.NaN })).resolves.toBeDefined();
      await expect(queryWith({ g: { $eq: Number.NaN } })).resolves.toBeDefined();
      await expect(queryWith({ g: { $in: [Number.NaN] } })).resolves.toBeDefined();
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const failure = await failureOf(() => queryWith({ g: { $gt: bad } }));
        expect(failure.name).toBe('ValidationException');
        expect(failure.message).toContain('Invalid filter');
      }
    }, 120_000);
  });
}
