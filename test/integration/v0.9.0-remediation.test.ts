import { randomUUID } from 'node:crypto';

import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, expect, it, afterAll } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — 0.9.0 review remediations (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const DIM = 4;

  /** Deterministic embeddings that count their own calls, so "did we spend a
   * billable call we shouldn't have?" is directly observable. */
  function countingEmbeddings(onDocumentsCall?: (n: number) => void): {
    embeddings: EmbeddingsInterface;
    calls: { query: number; documents: number };
  } {
    const calls = { query: 0, documents: 0 };
    const embeddings: EmbeddingsInterface = {
      async embedDocuments(docs: string[]): Promise<number[][]> {
        calls.documents += 1;
        onDocumentsCall?.(calls.documents);
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

  function newStore(onDocumentsCall?: (n: number) => void): {
    store: AmazonS3Vectors;
    calls: { query: number; documents: number };
  } {
    const indexName = `rem090-${randomUUID().slice(0, 8)}`;
    createdIndexes.push(indexName);
    const { embeddings, calls } = countingEmbeddings(onDocumentsCall);
    const store = new AmazonS3Vectors(embeddings, {
      vectorBucketName: safeEnv.bucketName,
      indexName,
      region: safeEnv.region,
      distanceMetric: 'cosine',
    });
    return { store, calls };
  }

  describe('live AWS — 0.9.0 review remediations', () => {
    afterAll(async () => {
      for (const indexName of createdIndexes) {
        const cleanup = new AmazonS3Vectors(undefined, {
          vectorBucketName: safeEnv.bucketName,
          indexName,
          region: safeEnv.region,
        });
        try {
          await cleanup.delete({ deleteAll: true });
        } catch {
          // deleteAll is idempotent, so an index that never got created is fine.
        }
      }
    });

    // ── F1: abort must stop embedding immediately, not at the group edge ──

    it('stops embedding the instant the signal fires inside a concurrent group', async () => {
      const controller = new AbortController();
      // Abort during the 2nd embed call — the first batch *inside* the
      // concurrent group. Every later batch in that group would otherwise
      // still spend a full, uncancellable, billable embedding call.
      const { store, calls } = newStore((n) => {
        if (n === 2) controller.abort();
      });

      const docs = Array.from(
        { length: 12 },
        (_, i) => new Document({ pageContent: `live-abort-${i}` }),
      );

      const error = await store
        .addDocuments(docs, { batchSize: 1, signal: controller.signal })
        .catch((e: unknown) => e);

      expect(isS3VectorsError(error)).toBe(true);
      expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
      expect(calls.documents).toBe(2);
      // The batch that landed before the abort is still reported.
      expect((error as { context: { writtenIds?: string[] } }).context.writtenIds).toHaveLength(1);
    }, 180_000);

    // ── F3: a signal in the callbacks slot must fail closed ──────────────

    it('rejects an AbortSignal in the callbacks slot before spending embedQuery', async () => {
      const { store, calls } = newStore();
      await store.addDocuments([new Document({ pageContent: 'slot check' })], {
        ids: ['slot-1'],
      });
      const embedsAfterWrite = calls.query;

      const signal = new AbortController().signal;

      for (const call of [
        () => store.similaritySearch('slot check', 1, undefined, signal as never),
        () => store.similaritySearchWithScore('slot check', 1, undefined, signal as never),
      ]) {
        const error = await call().catch((e: unknown) => e);
        expect(isS3VectorsError(error)).toBe(true);
        expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
        expect((error as Error).message).toContain('4th argument');
      }

      // No billable query embedding was spent on either rejected call.
      expect(calls.query).toBe(embedsAfterWrite);

      // The 5th slot still works against the live service.
      await expect(
        store.similaritySearch('slot check', 1, undefined, undefined, undefined),
      ).resolves.toHaveLength(1);
    }, 180_000);

    // ── F4: a real k above one page must paginate, not fail ──────────────

    it('paginates a real search past the 100-result page size without hitting the guard', async () => {
      // Count real QueryVectors round trips through SDK middleware, so the
      // "it actually paginated" claim is evidenced rather than inferred.
      let queryCalls = 0;
      const client = new S3VectorsClient({ region: safeEnv.region });
      client.middlewareStack.add(
        (next, context) => async (args) => {
          if (context.commandName === 'QueryVectorsCommand') queryCalls += 1;
          return next(args);
        },
        { step: 'initialize', name: 'countQueryVectors' },
      );

      const indexName = `rem090-${randomUUID().slice(0, 8)}`;
      createdIndexes.push(indexName);
      const { embeddings } = countingEmbeddings();
      const store = new AmazonS3Vectors(embeddings, {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
        distanceMetric: 'cosine',
        client,
      });

      // 150 vectors is more than AWS's documented maximum page size (100),
      // so satisfying k = 150 genuinely requires following nextToken. The
      // old flat page cap made this class of search fragile; it must simply
      // work, and must never surface QUERY_PAGE_LIMIT_EXCEEDED.
      const docs = Array.from(
        { length: 150 },
        (_, i) => new Document({ pageContent: `page-${i}`, metadata: { n: i } }),
      );
      await store.addDocuments(docs, { ids: docs.map((_, i) => `pg-${i}`) });

      const results = await store.similaritySearchVectorWithScore(
        Array.from({ length: DIM }, (_, d) => (d + 1) / 10),
        150,
      );

      // More results than AWS's documented maximum page size, which is only
      // reachable by following nextToken across pages.
      expect(results.length).toBeGreaterThan(100);
      expect(results).toHaveLength(150);
      expect(queryCalls).toBeGreaterThan(1);

      console.log(`[live] k=150 satisfied across ${queryCalls} QueryVectors page(s)`);
    }, 300_000);
  });
}
