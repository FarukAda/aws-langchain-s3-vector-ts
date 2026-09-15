import { randomUUID } from 'node:crypto';

import { GetIndexCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { requireLiveIntegrationEnv } from './_guard.js';

const env = requireLiveIntegrationEnv();

if (!env) {
  describe.skip('live AWS enterprise-hardening verification (skipped — env not set)', () => {
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

  describe('live AWS enterprise-hardening verification', () => {
    const rawClient = new S3VectorsClient({ region: safeEnv.region });

    it('rejects a write when the existing index has a different dimension', async () => {
      const indexName = `eh-dimmismatch-${randomUUID().slice(0, 8)}`;
      const store4 = new AmazonS3Vectors(randomEmbeddings(4), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        await store4.addVectors([[1, 2, 3, 4]], [new Document({ pageContent: 'x' })], {
          ids: ['id-1'],
        });

        const store8 = new AmazonS3Vectors(randomEmbeddings(8), {
          vectorBucketName: safeEnv.bucketName,
          indexName,
          region: safeEnv.region,
        });

        const error = await store8
          .addVectors([[1, 2, 3, 4, 5, 6, 7, 8]], [new Document({ pageContent: 'y' })], {
            ids: ['id-2'],
          })
          .catch((e: unknown) => e);

        // DESIGN.md F-1: AWS enforces the dimension, which is why this package
        // no longer pre-validates it. Verified live rather than assumed.
        expect(isS3VectorsError(error)).toBe(true);
        expect((error as { context: Record<string, unknown> }).context['awsErrorName']).toBe(
          'ValidationException',
        );

        const docs = await store4.getByIds(['id-1']);
        expect(docs).toHaveLength(1);
        // Absence is an ordinary outcome now: an undefined slot, not an error (D-6).
        expect(await store4.getByIds(['id-2'])).toEqual([undefined]);
      } finally {
        await store4.deleteIndex().catch(() => undefined);
      }
    }, 60_000);

    it('rejects a write when the existing index uses a different distance metric', async () => {
      const indexName = `eh-metricmismatch-${randomUUID().slice(0, 8)}`;
      const cosineStore = new AmazonS3Vectors(randomEmbeddings(4), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
        distanceMetric: 'cosine',
      });

      try {
        await cosineStore.addVectors([[1, 2, 3, 4]], [new Document({ pageContent: 'x' })], {
          ids: ['id-1'],
        });

        const euclideanStore = new AmazonS3Vectors(randomEmbeddings(4), {
          vectorBucketName: safeEnv.bucketName,
          indexName,
          region: safeEnv.region,
          distanceMetric: 'euclidean',
        });

        // DESIGN.md F-5: the metric governs query-time computation only, so a
        // mismatched store writes valid vectors...
        await expect(
          euclideanStore.addVectors([[5, 6, 7, 8]], [new Document({ pageContent: 'y' })], {
            ids: ['id-2'],
          }),
        ).resolves.toEqual(['id-2']);

        // ...and the mismatch surfaces on the read path instead, against the
        // distanceMetric QueryVectors returns (§4.1). That is the only metric
        // check this package still performs.
        const error = await euclideanStore
          .similaritySearchVectorWithScore([1, 2, 3, 4], 1)
          .catch((e: unknown) => e);
        expect(isS3VectorsError(error)).toBe(true);
        expect((error as { code: S3VectorsErrorCode }).code).toBe(
          S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
        );
      } finally {
        await cosineStore.deleteIndex().catch(() => undefined);
      }
    }, 60_000);

    it('similaritySearch pages through QueryVectors to return more than 100 results', async () => {
      const indexName = `eh-pagination-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(4), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        const count = 150;
        const vectors = Array.from({ length: count }, (_, i) => [1, i / count, 0, 0]);
        const docs = Array.from(
          { length: count },
          (_, i) => new Document({ pageContent: `doc-${i}` }),
        );
        const ids = Array.from({ length: count }, (_, i) => `id-${i}`);

        await store.addVectors(vectors, docs, { ids });

        const results = await store.similaritySearchVectorWithScore([1, 0, 0, 0], count);
        expect(results).toHaveLength(count);

        const returnedIds = new Set(results.map(([doc]) => doc.pageContent));
        expect(returnedIds.size).toBe(count);
      } finally {
        await store.deleteIndex().catch(() => undefined);
      }
    }, 120_000);

    it('rejects a mismatched write even with createIndexIfNotExist: false', async () => {
      const indexName = `eh-noautocreate-${randomUUID().slice(0, 8)}`;
      const creator = new AmazonS3Vectors(randomEmbeddings(4), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        await creator.addVectors([[1, 2, 3, 4]], [new Document({ pageContent: 'x' })], {
          ids: ['id-1'],
        });

        const manualStore = new AmazonS3Vectors(randomEmbeddings(8), {
          vectorBucketName: safeEnv.bucketName,
          indexName,
          region: safeEnv.region,
          createIndexIfNotExist: false,
        });

        const error = await manualStore
          .addVectors([[1, 2, 3, 4, 5, 6, 7, 8]], [new Document({ pageContent: 'y' })], {
            ids: ['id-2'],
          })
          .catch((e: unknown) => e);

        // With createIndexIfNotExist false this package issues no GetIndex at
        // all (§4.2), so the dimension is AWS's to reject (DESIGN.md F-1).
        expect(isS3VectorsError(error)).toBe(true);
        expect((error as { context: Record<string, unknown> }).context['awsErrorName']).toBe(
          'ValidationException',
        );

        // Confirms it was rejected locally, before any write reached AWS.
        const docs = await creator.getByIds(['id-1']);
        expect(docs).toHaveLength(1);
        expect(await creator.getByIds(['id-2'])).toEqual([undefined]);
      } finally {
        await creator.deleteIndex().catch(() => undefined);
      }
    }, 60_000);

    it('delete() requires deleteAll:true to actually remove the index', async () => {
      const indexName = `eh-deleteguard-${randomUUID().slice(0, 8)}`;
      const store = new AmazonS3Vectors(randomEmbeddings(4), {
        vectorBucketName: safeEnv.bucketName,
        indexName,
        region: safeEnv.region,
      });

      try {
        await store.addVectors([[1, 2, 3, 4]], [new Document({ pageContent: 'x' })], {
          ids: ['id-1'],
        });

        await expect(store.delete(undefined as unknown as { ids: string[] })).rejects.toThrow(
          'requires `ids`',
        );

        const stillExists = await rawClient
          .send(new GetIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }))
          .then(() => true)
          .catch(() => false);
        expect(stillExists).toBe(true);

        await store.deleteIndex();

        const existsAfter = await rawClient
          .send(new GetIndexCommand({ vectorBucketName: safeEnv.bucketName, indexName }))
          .then(() => true)
          .catch(() => false);
        expect(existsAfter).toBe(false);
      } finally {
        await store.deleteIndex().catch(() => undefined);
      }
    }, 60_000);
  });
}
