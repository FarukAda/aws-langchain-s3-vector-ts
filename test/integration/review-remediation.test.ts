import { randomUUID } from 'node:crypto';

import { PutVectorsCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { afterAll, describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — 0.8.0 review remediations (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const DIM = 4;

  /**
   * Deterministic embeddings that count their own calls. Bedrock is
   * deliberately not used here — S3 Vectors is the system under test, and a
   * counting stub is what makes the "did we skip the billable embed call?"
   * assertions observable at all.
   */
  function countingEmbeddings(): {
    embeddings: EmbeddingsInterface;
    calls: { query: number; documents: number };
  } {
    const calls = { query: 0, documents: 0 };
    const embeddings: EmbeddingsInterface = {
      async embedDocuments(docs: string[]): Promise<number[][]> {
        calls.documents += 1;
        return docs.map((_, i) => Array.from({ length: DIM }, (__, d) => (i + d + 1) / 10));
      },
      async embedQuery(_query: string): Promise<number[]> {
        calls.query += 1;
        return Array.from({ length: DIM }, (_, d) => (d + 1) / 10);
      },
    };
    return { embeddings, calls };
  }

  const createdIndexes: string[] = [];

  function newStore(overrides: Record<string, unknown> = {}): {
    store: AmazonS3Vectors;
    calls: { query: number; documents: number };
    indexName: string;
  } {
    const indexName = `remediation-${randomUUID().slice(0, 8)}`;
    createdIndexes.push(indexName);
    const { embeddings, calls } = countingEmbeddings();
    const store = new AmazonS3Vectors(embeddings, {
      vectorBucketName: safeEnv.bucketName,
      indexName,
      region: safeEnv.region,
      distanceMetric: 'cosine',
      ...overrides,
    });
    return { store, calls, indexName };
  }

  describe('live AWS — 0.8.0 review remediations', () => {
    afterAll(async () => {
      // Best-effort teardown of every index this file created.
      for (const indexName of createdIndexes) {
        const cleanup = new AmazonS3Vectors(undefined, {
          vectorBucketName: safeEnv.bucketName,
          indexName,
          region: safeEnv.region,
        });
        try {
          await cleanup.delete({ deleteAll: true });
        } catch {
          // deleteAll is idempotent as of 0.8.0, so a missing index is fine.
        }
      }
    });

    // ── N1: silent id corruption ────────────────────────────────────────

    it('rejects a non-array ids option instead of writing single-character keys', async () => {
      const { store } = newStore();

      const error = await store
        .addVectors(
          [
            [0.1, 0.2, 0.3, 0.4],
            [0.2, 0.3, 0.4, 0.5],
            [0.3, 0.4, 0.5, 0.6],
          ],
          [
            new Document({ pageContent: 'a' }),
            new Document({ pageContent: 'b' }),
            new Document({ pageContent: 'c' }),
          ],
          { ids: 'abc' as unknown as string[] },
        )
        .catch((e: unknown) => e);

      expect(isS3VectorsError(error)).toBe(true);
      expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);

      // Nothing was written: the index was never even created, so a fetch
      // for the corrupted keys fails at the index level rather than
      // returning them.
      const fetched = await store.getByIds(['a']).catch((e: unknown) => e);
      expect(isS3VectorsError(fetched)).toBe(true);
    }, 120_000);

    // ── IM6: deleteAll idempotency ──────────────────────────────────────

    it('resolves a second delete({ deleteAll: true }) cleanly', async () => {
      const { store } = newStore();
      await store.addDocuments([new Document({ pageContent: 'hello' })], { ids: ['d1'] });

      await expect(store.delete({ deleteAll: true })).resolves.toBeUndefined();
      // The regression: before 0.8.0 this second call rejected with
      // AWS_REQUEST_FAILED ("The specified index could not be found").
      await expect(store.delete({ deleteAll: true })).resolves.toBeUndefined();
    }, 120_000);

    // ── IM3 / IM2: cancellation ─────────────────────────────────────────

    it('skips the billable embedQuery entirely for an already-aborted search', async () => {
      const { store, calls } = newStore();
      await store.addDocuments([new Document({ pageContent: 'hello' })], { ids: ['d1'] });
      const embedsAfterWrite = calls.query;

      const controller = new AbortController();
      controller.abort();

      const error = await store
        .similaritySearch('hello', 1, undefined, undefined, controller.signal)
        .catch((e: unknown) => e);

      expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
      expect(calls.query).toBe(embedsAfterWrite);
    }, 120_000);

    it('honors an aborted signal in similaritySearchWithRelevanceScores in the 5th slot and rejects one in the 4th', async () => {
      const { store } = newStore();
      await store.addDocuments([new Document({ pageContent: 'hello' })], { ids: ['d1'] });

      const controller = new AbortController();
      controller.abort();

      // 5th slot — the house pattern, silently ignored before 0.8.0.
      const aligned = await store
        .similaritySearchWithRelevanceScores('hello', 1, undefined, undefined, controller.signal)
        .catch((e: unknown) => e);
      expect((aligned as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);

      // 4th slot — the historical position, honored through 0.x; since 1.0
      // it is the Callbacks slot like on every sibling, and a signal there
      // fails closed before the billable embedQuery call.
      const legacy = await store
        .similaritySearchWithRelevanceScores('hello', 1, undefined, controller.signal as never)
        .catch((e: unknown) => e);
      expect((legacy as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    }, 120_000);

    // ── Minor 2: non-string page-content value ──────────────────────────

    it('keeps a non-string _page_content value written by another producer', async () => {
      const { store, indexName } = newStore();
      await store.addDocuments([new Document({ pageContent: 'seed' })], { ids: ['seed'] });

      // Write a vector directly, bypassing this library's reserved-key
      // guard — simulating a vector written by something else sharing the
      // same index.
      const raw = new S3VectorsClient({ region: safeEnv.region });
      await raw.send(
        new PutVectorsCommand({
          vectorBucketName: safeEnv.bucketName,
          indexName,
          vectors: [
            {
              key: 'foreign',
              data: { float32: [0.9, 0.8, 0.7, 0.6] },
              metadata: { _page_content: 12345, other: 'kept' },
            },
          ],
        }),
      );

      const [doc] = await store.getByIds(['foreign']);

      expect(doc!.pageContent).toBe('');
      // The regression: before 0.8.0 the raw value was deleted outright.
      expect(doc!.metadata['_page_content']).toBe(12345);
      expect(doc!.metadata['other']).toBe('kept');
    }, 120_000);

    // ── Minor 4: later-batch dimension validation ───────────────────────

    it('gives a later batch the coded INDEX_CONFIG_MISMATCH, not a raw AWS error', async () => {
      const { store } = newStore();
      await store.addVectors([[0.1, 0.2, 0.3, 0.4]], [new Document({ pageContent: 'a' })], {
        ids: ['a'],
      });

      const error = await store
        .addVectors(
          [
            [0.1, 0.2, 0.3, 0.4],
            [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
          ],
          [new Document({ pageContent: 'b' }), new Document({ pageContent: 'c' })],
          { ids: ['b', 'c'], batchSize: 1 },
        )
        .catch((e: unknown) => e);

      // Before 0.8.0 this was AWS_REQUEST_FAILED wrapping a raw
      // ValidationException, for a mistake batch 0 reports precisely.
      expect((error as { code: S3VectorsErrorCode }).code).toBe(
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
      );
    }, 120_000);

    // ── Task 2: constructor client validation ───────────────────────────

    it('rejects a bad client with a coded error and accepts client: null', () => {
      expect(
        () =>
          new AmazonS3Vectors(undefined, {
            vectorBucketName: safeEnv.bucketName,
            indexName: 'irrelevant-index',
            client: {} as never,
          }),
      ).toThrow('is not an S3VectorsClient');

      const store = new AmazonS3Vectors(undefined, {
        vectorBucketName: safeEnv.bucketName,
        indexName: 'irrelevant-index',
        client: null as never,
        region: safeEnv.region,
      });
      expect(store.indexName).toBe('irrelevant-index');
    });

    // ── IM1 inverse: the new guards must not misfire on real responses ──

    it('real QueryVectors responses always satisfy the new fail-closed guards', async () => {
      const { store } = newStore();
      await store.addDocuments(
        [
          new Document({ pageContent: 'alpha', metadata: { tag: 'x' } }),
          new Document({ pageContent: 'beta', metadata: { tag: 'y' } }),
        ],
        { ids: ['a', 'b'] },
      );

      // A normal match, a filtered match, and a filter that matches nothing —
      // the three shapes the distance/distanceMetric guards must tolerate.
      const plain = await store.similaritySearchWithScore('alpha', 2);
      const filtered = await store.similaritySearchWithScore('alpha', 2, { tag: 'x' });
      const empty = await store.similaritySearchWithScore('alpha', 2, { tag: 'nothing-matches' });

      expect(plain.length).toBeGreaterThan(0);
      for (const [, distance] of [...plain, ...filtered]) {
        expect(typeof distance).toBe('number');
        expect(Number.isFinite(distance)).toBe(true);
      }
      expect(empty).toEqual([]);

      // Relevance scores convert cleanly rather than collapsing to the
      // best-possible 1.0 the old null-permitting guard would have produced.
      const scored = await store.similaritySearchWithRelevanceScores('alpha', 2);
      for (const [, score] of scored) {
        expect(Number.isFinite(score)).toBe(true);
      }
    }, 120_000);

    // ── Regression: the documented end-to-end flow still works ──────────

    it('runs the full documented lifecycle end to end', async () => {
      const { store } = newStore();

      const ids = await store.addDocuments(
        [
          new Document({ pageContent: 'the cat sat', metadata: { genre: 'a' } }),
          new Document({ pageContent: 'the dog ran', metadata: { genre: 'b' } }),
        ],
        { ids: ['doc-1', 'doc-2'] },
      );
      expect(ids).toEqual(['doc-1', 'doc-2']);

      const search = await store.similaritySearch('the cat sat', 2);
      expect(search.length).toBeGreaterThan(0);
      expect(search[0]!.pageContent).toBeTruthy();

      const scored = await store.similaritySearchWithRelevanceScores('the cat sat', 1);
      expect(scored).toHaveLength(1);

      const fetched = await store.getByIds(['doc-1']);
      expect(fetched[0]!.pageContent).toBe('the cat sat');
      expect(fetched[0]!.metadata['genre']).toBe('a');

      await store.delete({ ids: ['doc-1'] });
      await expect(store.getByIds(['doc-1'])).rejects.toMatchObject({
        code: S3VectorsErrorCode.NOT_FOUND,
      });

      await store.delete({ deleteAll: true });
    }, 180_000);
  });
}
