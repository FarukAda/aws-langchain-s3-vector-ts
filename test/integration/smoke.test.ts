import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS S3 Vectors smoke (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;

  describe('live AWS S3 Vectors smoke', () => {
    const indexName = `smoke-${randomUUID().slice(0, 8)}`;
    let store: AmazonS3Vectors;

    const randomEmbeddings: EmbeddingsInterface = {
      async embedDocuments(docs: string[]): Promise<number[][]> {
        return docs.map(() => Array.from({ length: 4 }, () => Math.random()));
      },
      async embedQuery(_query: string): Promise<number[]> {
        return Array.from({ length: 4 }, () => Math.random());
      },
    };

    beforeAll(() => {
      store = new AmazonS3Vectors(randomEmbeddings, {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
        distanceMetric: 'cosine',
      });
    });

    afterAll(async () => {
      try {
        await store.delete();
      } catch {
        // Best-effort teardown; the test framework will surface real
        // issues through the main assertions.
      }
    });

    it('creates index on first write, stores and queries a document', async () => {
      const ids = await store.addDocuments(
        [new Document({ pageContent: 'hello world', metadata: { genre: 'test' } })],
        { ids: ['doc-1'] },
      );
      expect(ids).toEqual(['doc-1']);

      const results = await store.similaritySearchWithScore('hello', 1);
      expect(results).toHaveLength(1);
      expect(results[0]![0].id).toBe('doc-1');
      expect(results[0]![0].metadata).toMatchObject({ genre: 'test' });
    }, 60_000);
  });
}
