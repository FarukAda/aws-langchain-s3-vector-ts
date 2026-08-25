import { randomUUID } from 'node:crypto';

import { GetIndexCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS bugfix verification (skipped — env not set)', () => {
    it('skipped', () => undefined);
  });
} else {
  const safeEnv = env;

  function randomEmbeddings(dimension = 4): EmbeddingsInterface {
    return {
      async embedDocuments(docs: string[]): Promise<number[][]> {
        return docs.map(() => Array.from({ length: dimension }, () => Math.random()));
      },
      async embedQuery(_query: string): Promise<number[]> {
        return Array.from({ length: dimension }, () => Math.random());
      },
    };
  }

  describe('live AWS bugfix verification', () => {
    const rawClient = new S3VectorsClient({ region: safeEnv.region });

    it('creates a new index with the page-content key auto-added to nonFilterableMetadataKeys', async () => {
      const indexName = `bf-nonfilter-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        await store.addDocuments([new Document({ pageContent: 'x'.repeat(100), metadata: {} })], {
          ids: ['id-1'],
        });

        const index = await rawClient.send(
          new GetIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }),
        );
        expect(index.index?.metadataConfiguration?.nonFilterableMetadataKeys).toContain(
          '_page_content',
        );
      } finally {
        await store.delete().catch(() => undefined);
      }
    }, 60_000);

    it('does not fail when two addDocuments calls race on creating a brand-new index', async () => {
      const indexName = `bf-race-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        const results = await Promise.all([
          store.addDocuments([new Document({ pageContent: 'a', metadata: {} })], { ids: ['a'] }),
          store.addDocuments([new Document({ pageContent: 'b', metadata: {} })], { ids: ['b'] }),
        ]);
        expect(results).toEqual([['a'], ['b']]);

        const docs = await store.getByIds(['a', 'b']);
        expect(docs.map((d) => d.id).sort()).toEqual(['a', 'b']);
      } finally {
        await store.delete().catch(() => undefined);
      }
    }, 60_000);

    it('similaritySearch uses queryEmbeddings; similaritySearchWithRelevanceScores returns scores', async () => {
      const indexName = `bf-search-${randomUUID().slice(0, 8)}`;
      const indexEmb = randomEmbeddings();
      const queryEmb = randomEmbeddings();
      const store = new AmazonS3Vectors(indexEmb, {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
        queryEmbeddings: queryEmb,
      });

      try {
        await store.addDocuments(
          [new Document({ pageContent: 'hello world', metadata: { genre: 'test' } })],
          { ids: ['doc-1'] },
        );

        const docs = await store.similaritySearch('hello', 1);
        expect(docs).toHaveLength(1);
        expect(docs[0]!.id).toBe('doc-1');

        const scored = await store.similaritySearchWithRelevanceScores('hello', 1);
        expect(scored).toHaveLength(1);
        expect(typeof scored[0]![1]).toBe('number');
      } finally {
        await store.delete().catch(() => undefined);
      }
    }, 60_000);

    it('addVectors rejects an empty first vector instead of creating a dimension-0 index', async () => {
      const indexName = `bf-empty-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        await expect(
          store.addVectors([[]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
        ).rejects.toThrow('Cannot determine vector dimension from empty batch');

        const exists = await rawClient
          .send(new GetIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }))
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);
      } finally {
        // Defensive: if a future regression of the guard above ever lets an
        // index get created here, don't leak it.
        await store.delete().catch(() => undefined);
      }
    }, 60_000);

    it('batchSize 0 throws immediately instead of hanging', async () => {
      const indexName = `bf-batchsize-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      await expect(
        store.addDocuments([new Document({ pageContent: 'x' })], { batchSize: 0 }),
      ).rejects.toThrow('batchSize must be a positive integer');
    }, 10_000);
  });
}
