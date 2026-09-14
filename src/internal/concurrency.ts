import { chunk, offsetBatches } from '../shared/batching.js';
import { attachPartialIds } from '../shared/errors/decorate.js';
import type { StoreScope } from './signals.js';

/** Which list of already-committed ids a failure should carry. */
type CommittedIdsKey = 'writtenIds' | 'deletedIds';

/** What every batched operation needs to report a partial failure. */
export interface BatchReporting extends StoreScope {
  /** The public method this batch belongs to; named in the error it raises. */
  readonly operation: string;
  /** Which list the ids belong under on a thrown error. */
  readonly key: CommittedIdsKey;
  /** Every id this call resolved, whether or not it committed. */
  readonly attemptedIds?: readonly string[] | undefined;
}

/**
 * Run one group of batch calls concurrently and collect what committed.
 *
 * Accepts:
 * - `group` — thunks, each resolving with the ids its call committed. They are
 *   started together; `Promise.allSettled` is what makes "settled, not
 *   cancelled" true of the siblings when one rejects.
 * - `collectedIds` — mutated in place, so a caller accumulating across groups
 *   keeps everything from the earlier ones.
 *
 * Returns: nothing. Ids land in `collectedIds` in **group order**, not
 * completion order, so a report reads the way the caller's input did.
 *
 * Throws: the first rejection, decorated with everything collected so far —
 * but only after every sibling has settled. A slower sibling that succeeds
 * *after* another has rejected must never be missing from that report: it
 * committed, and a caller cleaning up needs to know.
 */
export async function settleGroup(
  group: (() => Promise<string[]>)[],
  reporting: BatchReporting,
  collectedIds: string[],
): Promise<void> {
  const results = await Promise.allSettled(group.map((thunk) => thunk()));
  let firstError: unknown;
  let hasError = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      collectedIds.push(...result.value);
    } else if (!hasError) {
      hasError = true;
      firstError = result.reason;
    }
  }
  if (hasError) {
    const { operation, key, attemptedIds, ...scope } = reporting;
    throw attachPartialIds(firstError, operation, scope, key, collectedIds, attemptedIds);
  }
}

/**
 * Write the first batch alone and report the ids it committed.
 *
 * Accepts: the first batch, the full id list, and the write to perform.
 *
 * Returns: the ids that batch wrote — the slice both write paths then
 * accumulate into.
 *
 * Throws: the failure, decorated with an empty `writtenIds` and the full
 * `attemptedIds`: nothing committed, and a caller retrying needs the resolved
 * ids rather than a fresh set of UUIDs.
 *
 * Guarantees: the first batch is never concurrent with anything. It is the one
 * that may create the index, and every later batch's write depends on that
 * having happened.
 */
export async function writeFirstBatch<T>(
  firstBatch: readonly T[],
  ids: string[],
  operation: string,
  scope: StoreScope,
  write: () => Promise<void>,
): Promise<string[]> {
  try {
    await write();
    return ids.slice(0, firstBatch.length);
  } catch (error: unknown) {
    throw attachPartialIds(error, operation, scope, 'writtenIds', [], ids);
  }
}

/**
 * Run a per-batch write across pre-chunked batches, first batch alone.
 *
 * Accepts:
 * - `batches` — never empty; the only caller returns early on empty input.
 * - `ids` — the resolved id list, sliced per batch to report what committed.
 * - `maxConcurrent` — how many calls may be in flight at once.
 * - `action` — given a batch and its offset into the flat input.
 *
 * Returns: nothing.
 *
 * Throws: whatever `action` raises, carrying `context.writtenIds` and
 * `context.attemptedIds`.
 *
 * Guarantees: the **first** batch is awaited alone, because it is the one that
 * creates the index — every later batch's write depends on that having
 * happened. After it, batches are independent and run in groups of at most
 * `maxConcurrent`, each group through {@link settleGroup}, so a failure still
 * reports every id confirmed written: from earlier groups, and from siblings
 * that succeeded alongside the one that failed. No batch is dispatched after a
 * known failure.
 *
 * `addDocuments` deliberately does not route through here: its embedding step
 * stays strictly sequential across batches and is pipelined against the puts,
 * which this helper's grouped dispatch of ready-made batches cannot express.
 */
export async function runBatchesConcurrently<T>(
  batches: T[][],
  ids: string[],
  maxConcurrent: number,
  reporting: Omit<BatchReporting, 'key' | 'attemptedIds'>,
  action: (batch: T[], offset: number) => Promise<void>,
): Promise<void> {
  const { operation, ...scope } = reporting;
  const firstBatch = batches[0]!;
  const writtenIds = await writeFirstBatch(firstBatch, ids, operation, scope, () =>
    action(firstBatch, 0),
  );

  const rest = offsetBatches(batches.slice(1), firstBatch.length);

  for (const group of chunk(rest, maxConcurrent)) {
    await settleGroup(
      group.map(
        ({ batch, offset: batchOffset }) =>
          () =>
            action(batch, batchOffset).then(() =>
              ids.slice(batchOffset, batchOffset + batch.length),
            ),
      ),
      { ...reporting, key: 'writtenIds', attemptedIds: ids },
      writtenIds,
    );
  }
}
