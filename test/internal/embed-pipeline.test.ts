import { describe, it, expect } from '@jest/globals';
import { Document, type DocumentInterface } from '@langchain/core/documents';

import { embedAndWrite } from '../../src/internal/embed-pipeline.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of the embed/write pipeline (docs/CONTRACTS-DRAFT.md,
 * "Write path"). Its whole reason to exist is the shape of the concurrency:
 * embedding strictly sequential, writing pipelined behind it, and a
 * partial-failure report that stays in document order however the writes
 * happen to settle.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const docs = (n: number): DocumentInterface[] =>
  Array.from({ length: n }, (_, i) => new Document({ pageContent: `d-${i}` }));

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id-${i}`);

const contextOf = (error: unknown): Record<string, unknown> =>
  (error as { context: Record<string, unknown> }).context;

interface Run {
  embedCalls: number;
  concurrentEmbeds: number;
  peakInFlightPuts: number;
  putOrder: number[];
}

function harness(overrides: {
  embedDelay?: number;
  putDelay?: (offset: number) => number;
  failPutAt?: number;
  failEmbedAt?: number;
  signal?: AbortSignal;
  maxConcurrent?: number;
  count?: number;
}): { run: () => Promise<void>; state: Run } {
  const state: Run = { embedCalls: 0, concurrentEmbeds: 0, peakInFlightPuts: 0, putOrder: [] };
  let embedsInFlight = 0;
  let putsInFlight = 0;
  const count = overrides.count ?? 5;

  const run = (): Promise<void> =>
    embedAndWrite({
      operation: 'addDocuments',
      documents: docs(count),
      ids: ids(count),
      batchSize: 1,
      maxConcurrent: overrides.maxConcurrent ?? 2,
      signal: overrides.signal,
      embed: async (batch) => {
        embedsInFlight += 1;
        state.concurrentEmbeds = Math.max(state.concurrentEmbeds, embedsInFlight);
        state.embedCalls += 1;
        if (state.embedCalls === overrides.failEmbedAt) {
          embedsInFlight -= 1;
          throw new Error('embed boom');
        }
        await after(overrides.embedDelay ?? 1);
        embedsInFlight -= 1;
        return batch.map(() => [1, 2, 3]);
      },
      put: async (_batch, offset) => {
        putsInFlight += 1;
        state.peakInFlightPuts = Math.max(state.peakInFlightPuts, putsInFlight);
        await after(overrides.putDelay?.(offset) ?? 1);
        putsInFlight -= 1;
        if (offset === overrides.failPutAt) throw new Error('put boom');
        state.putOrder.push(offset);
      },
      ...SCOPE,
    });

  return { run, state };
}

describe('embedAndWrite', () => {
  it('embeds one batch at a time, never concurrently', async () => {
    const { run, state } = harness({ embedDelay: 5 });
    await run();
    expect(state.embedCalls).toBe(5);
    expect(state.concurrentEmbeds).toBe(1);
  });

  it('keeps writes in flight while the next batch embeds', async () => {
    const { run, state } = harness({ putDelay: () => 20, maxConcurrent: 3 });
    await run();
    // Serial embed-then-put would never have two puts outstanding at once.
    expect(state.peakInFlightPuts).toBeGreaterThan(1);
  });

  it('never exceeds the write window', async () => {
    const { run, state } = harness({ putDelay: () => 20, maxConcurrent: 2, count: 8 });
    await run();
    expect(state.peakInFlightPuts).toBeLessThanOrEqual(2);
  });

  it('reports written ids in document order however the writes settle', async () => {
    // Later batches finish first; the report must not follow that order.
    const { run } = harness({ putDelay: (offset) => 30 - offset * 5, failPutAt: 4 });
    const error = await run().catch((e: unknown) => e);
    expect(contextOf(error)['writtenIds']).toEqual(['id-0', 'id-1', 'id-2', 'id-3']);
  });

  it('reports nothing written when the first batch fails', async () => {
    const { run } = harness({ failPutAt: 0 });
    const error = await run().catch((e: unknown) => e);
    expect(contextOf(error)['writtenIds']).toEqual([]);
    expect(contextOf(error)['attemptedIds']).toHaveLength(5);
  });

  it('surfaces an embedding failure, not a write failure', async () => {
    const { run } = harness({ failEmbedAt: 3 });
    const error = await run().catch((e: unknown) => e);
    expect((error as Error).message).toContain('embed boom');
  });

  it('stops embedding after a write has already failed', async () => {
    const { run, state } = harness({ failPutAt: 1, putDelay: () => 1, count: 6 });
    await run().catch(() => undefined);
    // Batch 0, then 1 (which fails) — a couple more may already be embedded
    // before the rejection lands, but not all six.
    expect(state.embedCalls).toBeLessThan(6);
  });

  it('rejects before embedding anything when the signal has already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, state } = harness({ signal: controller.signal });
    const error = await run().catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(state.embedCalls).toBe(0);
  });

  it('stops at the next batch when the signal fires mid-run', async () => {
    const controller = new AbortController();
    const { run, state } = harness({
      signal: controller.signal,
      putDelay: (offset) => {
        if (offset === 0) controller.abort();
        return 1;
      },
      count: 6,
    });
    const error = await run().catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(state.embedCalls).toBeLessThan(6);
    // The first batch did land, and says so.
    expect(contextOf(error)['writtenIds']).toEqual(['id-0']);
  });
});
