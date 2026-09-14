import { describe, it, expect } from '@jest/globals';

import {
  runBatchesConcurrently,
  settleGroup,
  writeFirstBatch,
} from '../../src/internal/concurrency.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of the batch-concurrency helpers
 * (docs/CONTRACTS-DRAFT.md, "Write path"). What these own is the reporting of
 * partial progress: which ids are known to have committed when something
 * fails, and in what order they are reported.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const contextOf = (error: unknown): Record<string, unknown> =>
  (error as { context: Record<string, unknown> }).context;

describe('settleGroup', () => {
  it('collects ids in group order, not completion order', async () => {
    const collected: string[] = [];
    await settleGroup(
      [
        async () => {
          await after(20);
          return ['slow'];
        },
        async () => ['fast'],
      ],
      { operation: 'addVectors', key: 'writtenIds', ...SCOPE },
      collected,
    );
    // The second thunk settles first; the report still reads in input order,
    // which is what keeps writtenIds aligned with the caller's documents.
    expect(collected).toEqual(['slow', 'fast']);
  });

  it('waits for every sibling before throwing, so a late success is still reported', async () => {
    const collected: string[] = [];
    const error = await settleGroup(
      [
        async () => {
          throw new Error('boom');
        },
        async () => {
          await after(20);
          return ['late-success'];
        },
      ],
      { operation: 'addVectors', key: 'writtenIds', ...SCOPE },
      collected,
    ).catch((e: unknown) => e);

    expect((error as Error).message).toContain('boom');
    expect(contextOf(error)['writtenIds']).toEqual(['late-success']);
  });

  it('reports the first rejection when several fail', async () => {
    const error = await settleGroup(
      [
        async () => {
          throw new Error('first');
        },
        async () => {
          throw new Error('second');
        },
      ],
      { operation: 'delete', key: 'deletedIds', ...SCOPE },
      [],
    ).catch((e: unknown) => e);
    expect((error as Error).message).toContain('first');
  });

  it('files the ids under the key the operation uses', async () => {
    const error = await settleGroup(
      [
        async () => ['gone'],
        async () => {
          throw new Error('boom');
        },
      ],
      { operation: 'delete', key: 'deletedIds', ...SCOPE },
      [],
    ).catch((e: unknown) => e);
    expect(contextOf(error)['deletedIds']).toEqual(['gone']);
    expect(contextOf(error)).not.toHaveProperty('writtenIds');
  });

  it('carries the attempted ids when the operation supplies them', async () => {
    const error = await settleGroup(
      [
        async () => {
          throw new Error('boom');
        },
      ],
      { operation: 'addVectors', key: 'writtenIds', attemptedIds: ['a', 'b'], ...SCOPE },
      [],
    ).catch((e: unknown) => e);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });
});

describe('writeFirstBatch', () => {
  it('returns exactly the ids that batch covers', async () => {
    const ids = await writeFirstBatch([1, 2], ['a', 'b', 'c'], 'addVectors', SCOPE, async () => {
      // nothing to do: the write itself is the caller's
    });
    expect(ids).toEqual(['a', 'b']);
  });

  it('reports nothing written when the first batch fails, and every id attempted', async () => {
    const error = await writeFirstBatch([1], ['a', 'b'], 'addVectors', SCOPE, () =>
      Promise.reject(new Error('boom')),
    ).catch((e: unknown) => e);
    expect(contextOf(error)['writtenIds']).toEqual([]);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });
});

describe('runBatchesConcurrently', () => {
  it('awaits the first batch alone before starting any other', async () => {
    const started: number[] = [];
    let firstDone = false;
    await runBatchesConcurrently(
      [[0], [1], [2]],
      ['a', 'b', 'c'],
      10,
      { operation: 'addVectors', ...SCOPE },
      async (_batch, offset) => {
        started.push(offset);
        if (offset === 0) {
          await after(10);
          firstDone = true;
          return;
        }
        // Every later batch must see the first one already finished: it is
        // the one that creates the index.
        expect(firstDone).toBe(true);
      },
    );
    expect(started[0]).toBe(0);
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBatchesConcurrently(
      Array.from({ length: 9 }, (_, i) => [i]),
      Array.from({ length: 9 }, (_, i) => `id-${i}`),
      2,
      { operation: 'addVectors', ...SCOPE },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await after(5);
        inFlight -= 1;
      },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('reports the first batch as written when a later one fails', async () => {
    const error = await runBatchesConcurrently(
      [[0], [1]],
      ['a', 'b'],
      10,
      { operation: 'addVectors', ...SCOPE },
      async (_batch, offset) => {
        if (offset !== 0) throw new Error('boom');
      },
    ).catch((e: unknown) => e);

    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)['writtenIds']).toEqual(['a']);
    expect(contextOf(error)['attemptedIds']).toEqual(['a', 'b']);
  });

  it('stops dispatching groups after a failure', async () => {
    const seen: number[] = [];
    await runBatchesConcurrently(
      Array.from({ length: 5 }, (_, i) => [i]),
      Array.from({ length: 5 }, (_, i) => `id-${i}`),
      1,
      { operation: 'addVectors', ...SCOPE },
      async (_batch, offset) => {
        seen.push(offset);
        if (offset === 1) throw new Error('boom');
      },
    ).catch(() => undefined);
    // Batch 0 alone, then the group containing batch 1 fails; nothing after.
    expect(seen).toEqual([0, 1]);
  });
});
