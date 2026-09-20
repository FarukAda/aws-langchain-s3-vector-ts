import { describe, it, expect } from '@jest/globals';

import { runBatches, type BatchedRun } from '../../src/internal/concurrency.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { gate } from '../helpers.js';

/**
 * One test per domain cell of the batched-operation runner. What it owns is the
 * reporting of partial progress: which ids are known to have committed when
 * something fails, and in what order they are reported.
 *
 * How much runs at once is the window's, and is tested in `window.test.ts`.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const contextOf = (error: unknown): Record<string, unknown> =>
  (error as { context: Record<string, unknown> }).context;

/** A run with the fields every test here shares, overridable per case. */
function run<T>(overrides: Partial<BatchedRun<T>> & Pick<BatchedRun<T>, 'batches' | 'action'>) {
  return runBatches<T>({
    ids: [],
    maxConcurrent: 10,
    serializeFirstBatch: true,
    operation: 'addVectors',
    contextField: 'writtenIds',
    ...SCOPE,
    ...overrides,
  });
}

describe('runBatches, reporting what committed', () => {
  it('collects ids in batch order, not completion order', async () => {
    // The second batch opens the gate the first is waiting on, so "second
    // settles first" is a fact of the test rather than a head start.
    const releaseSlow = gate();
    const error = await run<number>({
      batches: [[0], [1], [2]],
      ids: ['first', 'slow', 'fast'],
      serializeFirstBatch: true,
      attemptedIds: ['first', 'slow', 'fast'],
      action: async (_batch, offset) => {
        if (offset === 1) await releaseSlow.promise;
        if (offset === 2) {
          releaseSlow.open();
          throw new Error('boom');
        }
      },
    }).catch((e: unknown) => e);
    // The third batch settles first; the report still reads in input order,
    // which is what keeps writtenIds aligned with the caller's documents.
    expect(contextOf(error)['writtenIds']).toEqual(['first', 'slow']);
  });

  it('waits for every sibling before throwing, so a late success is still reported', async () => {
    const releaseLate = gate();
    const error = await run<number>({
      batches: [[0], [1], [2]],
      ids: ['a', 'b', 'c'],
      serializeFirstBatch: false,
      action: async (_batch, offset) => {
        if (offset === 0) {
          // Released before throwing, so the sibling is provably still pending
          // at the moment of the rejection — which is the thing being asserted.
          releaseLate.open();
          throw new Error('boom');
        }
        if (offset === 1) await releaseLate.promise;
      },
    }).catch((e: unknown) => e);

    expect((error as Error).message).toContain('boom');
    // `b` was still pending when the first batch rejected and committed after
    // it, and is reported anyway — that is the guarantee. `c` is absent for the
    // other half of the contract: once one batch has failed, no further batch
    // is dispatched.
    expect(contextOf(error)['writtenIds']).toEqual(['b']);
  });

  it('reports the first rejection when several fail', async () => {
    const error = await run<number>({
      batches: [[0], [1]],
      ids: ['a', 'b'],
      serializeFirstBatch: false,
      operation: 'delete',
      contextField: 'deletedIds',
      action: (_batch, offset) => Promise.reject(new Error(offset === 0 ? 'first' : 'second')),
    }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('first');
  });

  it('files the ids under the field the operation uses', async () => {
    const error = await run<number>({
      batches: [[0], [1]],
      ids: ['gone', 'b'],
      serializeFirstBatch: false,
      operation: 'delete',
      contextField: 'deletedIds',
      action: (_batch, offset) =>
        offset === 0 ? Promise.resolve() : Promise.reject(new Error('boom')),
    }).catch((e: unknown) => e);
    expect(contextOf(error)['deletedIds']).toEqual(['gone']);
    expect(contextOf(error)).not.toHaveProperty('writtenIds');
  });

  it('carries every id the call attempted', async () => {
    const error = await run<number>({
      batches: [[0]],
      ids: ['a', 'b'],
      attemptedIds: ['a', 'b'],
      action: () => Promise.reject(new Error('boom')),
    }).catch((e: unknown) => e);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });

  it('reports nothing committed when the first batch fails', async () => {
    const error = await run<number>({
      batches: [[0], [1]],
      ids: ['a', 'b'],
      attemptedIds: ['a', 'b'],
      action: () => Promise.reject(new Error('boom')),
    }).catch((e: unknown) => e);
    expect(contextOf(error)['writtenIds']).toEqual([]);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });

  it('reports the first batch as committed when a later one fails', async () => {
    const error = await run<number>({
      batches: [[0], [1]],
      ids: ['a', 'b'],
      attemptedIds: ['a', 'b'],
      action: (_batch, offset) => {
        if (offset !== 0) throw new Error('boom');
        return Promise.resolve();
      },
    }).catch((e: unknown) => e);

    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)['writtenIds']).toEqual(['a']);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });
});

describe('runBatches, dispatching', () => {
  it('awaits the first batch alone before starting any other', async () => {
    const started: number[] = [];
    let firstDone = false;
    await run<number>({
      batches: [[0], [1], [2]],
      ids: ['a', 'b', 'c'],
      action: async (_batch, offset) => {
        started.push(offset);
        if (offset === 0) {
          // Asynchronous is the whole requirement: what is being asserted is
          // that the first batch is *awaited*, not that it is slow.
          await Promise.resolve();
          firstDone = true;
          return;
        }
        // Every later batch must see the first one already finished: it is
        // the one that creates the index.
        expect(firstDone).toBe(true);
      },
    });
    expect(started[0]).toBe(0);
  });

  it('starts every batch at once when nothing has to land first', async () => {
    const started: number[] = [];
    await run<number>({
      batches: [[0], [1]],
      ids: ['a', 'b'],
      serializeFirstBatch: false,
      operation: 'delete',
      contextField: 'deletedIds',
      action: (_batch, offset) => {
        started.push(offset);
        return Promise.resolve();
      },
    });
    expect(started).toEqual([0, 1]);
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    await run<number>({
      batches: Array.from({ length: 9 }, (_, i) => [i]),
      ids: Array.from({ length: 9 }, (_, i) => `id-${i}`),
      maxConcurrent: 2,
      action: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('stops dispatching after a failure', async () => {
    const seen: number[] = [];
    await run<number>({
      batches: Array.from({ length: 5 }, (_, i) => [i]),
      ids: Array.from({ length: 5 }, (_, i) => `id-${i}`),
      maxConcurrent: 1,
      action: async (_batch, offset) => {
        seen.push(offset);
        if (offset === 1) throw new Error('boom');
      },
    }).catch(() => undefined);
    // Batch 0 alone, then batch 1 fails; nothing after it is dispatched.
    expect(seen).toEqual([0, 1]);
  });

  it('issues no call for an empty batch list', async () => {
    let calls = 0;
    await run<number>({
      batches: [],
      ids: [],
      action: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    expect(calls).toBe(0);
  });
});
