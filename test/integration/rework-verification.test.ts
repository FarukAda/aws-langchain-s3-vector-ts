import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { requireLiveIntegrationEnv } from './_guard.js';

/**
 * Live cover for the capabilities the contract rework added or changed:
 * enumeration (D-25), MMR (D-5), the retriever's two signals (D-18), and the
 * `(Document | undefined)[]` shape of `getByIds` (D-6).
 *
 * The unit suite proves these against a mocked client, which cannot show that
 * the requests are ones AWS accepts. That is all this file adds — one live
 * round trip per capability, against an index created and destroyed here.
 */
const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS — contract rework (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;
  const DIM = 4;

  /**
   * Deterministic embeddings, so a search's expected order is a fact about
   * this file rather than about a model. Each text maps to a fixed unit-ish
   * vector: `alpha` and `beta` are near each other, `gamma` is orthogonal.
   */
  const VECTORS: Record<string, number[]> = {
    alpha: [1, 0, 0, 0],
    beta: [0.9, 0.1, 0, 0],
    gamma: [0, 1, 0, 0],
  };

  const embeddings: EmbeddingsInterface = {
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map((text) => VECTORS[text] ?? [0.5, 0.5, 0.5, 0.5]);
    },
    async embedQuery(query: string): Promise<number[]> {
      return VECTORS[query] ?? [1, 0, 0, 0];
    },
  };

  const indexName = `rework-${randomUUID().slice(0, 8)}`;
  const store = new AmazonS3Vectors(embeddings, {
    vectorBucketName: safeEnv.bucketName,
    indexName,
    region: safeEnv.region,
    distanceMetric: 'cosine',
  });

  describe('live AWS — contract rework', () => {
    beforeAll(async () => {
      await store.addDocuments(
        Object.keys(VECTORS).map(
          (text) => new Document({ pageContent: text, metadata: { topic: text } }),
        ),
        { ids: Object.keys(VECTORS) },
      );
    }, 180_000);

    afterAll(async () => {
      try {
        await store.delete({ deleteAll: true });
      } catch {
        // Best-effort teardown: a failed setup leaves nothing to delete.
      }
    }, 120_000);

    it('getByIds answers an absent id with undefined in its slot', async () => {
      const found = await store.getByIds(['alpha', 'does-not-exist', 'gamma']);
      expect(found).toHaveLength(3);
      expect(found[0]?.pageContent).toBe('alpha');
      expect(found[1]).toBeUndefined();
      expect(found[2]?.pageContent).toBe('gamma');
    }, 120_000);

    it('listDocuments enumerates the whole index across pages', async () => {
      // pageSize 1 forces the nextToken loop to run for real rather than
      // finishing in a single response.
      const ids: (string | undefined)[] = [];
      for await (const doc of store.listDocuments({ pageSize: 1 })) ids.push(doc.id);
      expect(ids.sort()).toEqual(['alpha', 'beta', 'gamma']);
    }, 180_000);

    it('listDocuments round-trips page content and metadata', async () => {
      const byId = new Map<string | undefined, Document>();
      for await (const doc of store.listDocuments()) byId.set(doc.id, doc);
      expect(byId.get('alpha')?.pageContent).toBe('alpha');
      expect(byId.get('alpha')?.metadata).toEqual({ topic: 'alpha' });
    }, 120_000);

    it('listVectors yields embeddings that can be written straight into another index', async () => {
      const copyName = `rework-copy-${randomUUID().slice(0, 8)}`;
      const copy = new AmazonS3Vectors(embeddings, {
        vectorBucketName: safeEnv.bucketName,
        indexName: copyName,
        region: safeEnv.region,
        distanceMetric: 'cosine',
      });

      try {
        const ids: string[] = [];
        const vectors: number[][] = [];
        const documents: Document[] = [];
        for await (const record of store.listVectors()) {
          expect(record.vector).toHaveLength(DIM);
          ids.push(record.id);
          vectors.push(record.vector);
          documents.push(record.document);
        }

        // The migration path AWS's immutability rule makes mandatory: an
        // index's dimension and metric cannot change, so the only way to
        // change either is to copy every record into a new index.
        await copy.addVectors(vectors, documents, { ids });
        const copied = await copy.getByIds(['alpha']);
        expect(copied[0]?.pageContent).toBe('alpha');
      } finally {
        await copy.delete({ deleteAll: true }).catch(() => undefined);
      }
    }, 300_000);

    it('maxMarginalRelevanceSearch returns k documents from a real query', async () => {
      const docs = await store.maxMarginalRelevanceSearch('alpha', {
        k: 2,
        fetchK: 3,
        lambda: 0.5,
      });
      expect(docs).toHaveLength(2);
      expect(new Set(docs.map((doc) => doc.id)).size).toBe(2);
    }, 180_000);

    it('a retriever field signal cancels the AWS request', async () => {
      const controller = new AbortController();
      controller.abort();
      const error = await store
        .asRetriever({ k: 1, signal: controller.signal })
        .invoke('alpha')
        .catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    }, 120_000);

    it('a retriever without a signal still returns documents', async () => {
      expect(await store.asRetriever({ k: 2 }).invoke('alpha')).toHaveLength(2);
    }, 120_000);

    it('a deleted index is re-created by the next write, from this store config', async () => {
      const cycleName = `rework-cycle-${randomUUID().slice(0, 8)}`;
      const cycle = new AmazonS3Vectors(embeddings, {
        vectorBucketName: safeEnv.bucketName,
        indexName: cycleName,
        region: safeEnv.region,
        distanceMetric: 'cosine',
      });

      try {
        await cycle.addDocuments([new Document({ pageContent: 'alpha' })], { ids: ['a'] });
        await cycle.delete({ deleteAll: true });
        // The lifecycle's "known to exist" flag must have been cleared, or
        // this write would PutVectors into an index that is gone.
        await cycle.addDocuments([new Document({ pageContent: 'beta' })], { ids: ['b'] });
        expect((await cycle.getByIds(['b']))[0]?.pageContent).toBe('beta');
      } finally {
        await cycle.delete({ deleteAll: true }).catch(() => undefined);
      }
    }, 300_000);
  });
}
