import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { createMockClient } from '../helpers.js';

const BASE_CONFIG = { vectorBucketName: 'test-bucket', indexName: 'test-index' } as const;

describe('delete batching property', () => {
  it('issues ceil(n / batchSize) DeleteVectors calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        async (n, batchSize) => {
          const { client, mock } = createMockClient();
          mock.on(DeleteVectorsCommand).resolves({});
          const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
          const ids = Array.from({ length: n }, (_, i) => `id-${i}`);
          await store.delete({ ids, batchSize });
          expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(Math.ceil(n / batchSize));
        },
      ),
    );
  });
});
