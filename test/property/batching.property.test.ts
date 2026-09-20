import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { BASE_CONFIG, createMockClient } from '../helpers.js';

/**
 * What batching has to preserve, over every split it can produce.
 *
 * The call *count* was the only thing asserted here, and a count is exactly
 * what a partitioning bug preserves: sending batch 0 twice and dropping batch
 * 1, or reordering, or losing the last id, all produce `ceil(n / batchSize)`
 * calls and passed. The count is still checked — it is the one thing that says
 * `batchSize` was honoured at all — but what matters is that the keys AWS
 * receives are the ids the caller passed, once each, in order.
 */
describe('delete batching property', () => {
  /** Run one delete and report what reached `DeleteVectors`. */
  const keysSentFor = async (n: number, batchSize: number): Promise<string[][]> => {
    const { client, mock } = createMockClient();
    mock.on(DeleteVectorsCommand).resolves({});
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const ids = Array.from({ length: n }, (_, i) => `id-${i}`);
    await store.delete({ ids, batchSize });
    return mock.commandCalls(DeleteVectorsCommand).map((call) => call.args[0].input.keys!);
  };

  it('sends every id exactly once, in order, across the batches', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        async (n, batchSize) => {
          const batches = await keysSentFor(n, batchSize);
          const expected = Array.from({ length: n }, (_, i) => `id-${i}`);
          expect(batches.flat()).toEqual(expected);
        },
      ),
    );
  });

  it('puts at most batchSize ids in a request, and fills every one but the last', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        async (n, batchSize) => {
          const batches = await keysSentFor(n, batchSize);
          expect(batches).toHaveLength(Math.ceil(n / batchSize));
          // A short batch anywhere but the end means the split wasted a
          // request, which is the thing `batchSize` exists to control.
          for (const batch of batches.slice(0, -1)) expect(batch).toHaveLength(batchSize);
          expect(batches.at(-1)!.length).toBeGreaterThan(0);
          expect(batches.at(-1)!.length).toBeLessThanOrEqual(batchSize);
        },
      ),
    );
  });

  it('sends no empty request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        async (n, batchSize) => {
          const batches = await keysSentFor(n, batchSize);
          expect(batches.every((batch) => batch.length > 0)).toBe(true);
        },
      ),
    );
  });
});
