/**
 * Hides how many requests are in flight, and what a half-finished write owes
 * the caller.
 *
 * A batched operation is a fan-out with a bound, and the bound is the decision:
 * it caps both the request rate against a shared account quota and the peak
 * payload held in memory. The other half is what a failure carries — the ids
 * that did commit, under the field the operation names — so a caller can retry
 * in place instead of writing everything again under fresh ids.
 */
import { offsetBatches } from '../shared/batching.js';
import { attachPartialIds } from '../shared/errors/decorate.js';
import type { StoreScope } from '../shared/scope.js';

/** Which list of already-committed ids a failure should carry. */
type CommittedIdsField = 'writtenIds' | 'deletedIds';

/** What a window holds once everything launched into it has settled. */
interface WindowOutcome<T> {
  /** One slot per launch, in launch order; `undefined` where that unit failed. */
  readonly results: readonly (T | undefined)[];
  /** Whether any unit failed. Separate from `error`, which may legitimately be `undefined`. */
  readonly failed: boolean;
  /** The reason the *first* failing unit rejected with. */
  readonly error: unknown;
}

/**
 * A bounded amount of work in flight, with the first failure latched.
 *
 * Three call sites used to decide this for themselves, and they did not agree:
 * two dispatched fixed groups, so one slow request held back every request
 * behind it until its whole group settled, while the third slid a window and
 * did not. A window is the better of the two and is now the only one — which
 * became true later than this comment first claimed it: the `GetVectors`
 * fan-out in `get-vectors.ts` kept its fixed groups for a further release,
 * head-of-line blocking every ten batches on `getByIds` and on MMR's candidate
 * fetch, while this paragraph said otherwise.
 */
export interface ConcurrencyWindow<T> {
  /**
   * Start one unit of work, first waiting for a slot if the window is full.
   *
   * A thunk rather than a promise: a promise argument would already have
   * dispatched its request before the window could decide to wait.
   */
  launch(thunk: () => Promise<T>): Promise<void>;
  /**
   * Whether a unit has already failed, so a caller can stop feeding the window
   * rather than launch work whose result will be discarded.
   *
   * Only failures observed so far — a unit still in flight may yet fail.
   */
  hasFailed(): boolean;
  /**
   * Latch a failure that did not come from a launched unit — one raised while
   * preparing the next one, such as an embedding call that rejected before
   * there was anything to write.
   *
   * The first failure wins here exactly as it does for a launched unit, so a
   * caller does not have to know which of the two came first.
   */
  fail(error: unknown): void;
  /** Wait for every launched unit, then report what committed and what failed. */
  settle(): Promise<WindowOutcome<T>>;
}

/**
 * Open a window admitting `maxConcurrent` units at a time.
 *
 * Accepts: the cap, an integer of 1 or more. Callers take it from the store's
 * `maxConcurrentBatchCalls`, which validation has already bounded.
 *
 * Returns: a window. Nothing runs until something is launched into it.
 *
 * Throws: nothing — a unit's rejection is latched, not propagated, so one
 * failure never becomes an unhandled rejection while siblings are still in
 * flight.
 *
 * Guarantees: results keep launch order rather than completion order, because
 * that is the order a caller's ids are in and a partial-failure report is only
 * useful in the caller's order. Every launched unit is awaited before
 * {@link ConcurrencyWindow.settle} resolves, so a success that lands after the
 * first failure is still reported.
 */
export function openWindow<T>(maxConcurrent: number): ConcurrencyWindow<T> {
  const inFlight = new Set<Promise<void>>();
  const results: (T | undefined)[] = [];
  let firstError: unknown;
  let failed = false;

  const record = (error: unknown): void => {
    if (failed) return;
    failed = true;
    firstError = error;
  };

  return {
    async launch(thunk: () => Promise<T>): Promise<void> {
      const slot = results.length;
      results.push(undefined);
      const tracked: Promise<void> = thunk()
        .then((value) => {
          results[slot] = value;
        }, record)
        .finally(() => {
          inFlight.delete(tracked);
        });
      inFlight.add(tracked);
      if (inFlight.size >= maxConcurrent) {
        // Tracked promises never reject — `record` absorbs the rejection — so
        // racing them only ever waits for one to settle.
        await Promise.race(inFlight);
      }
    },
    hasFailed(): boolean {
      return failed;
    },
    fail: record,
    async settle(): Promise<WindowOutcome<T>> {
      await Promise.all(inFlight);
      return { results, failed, error: firstError };
    },
  };
}

/** Everything a batched operation needs to fan out and report what committed. */
export interface BatchedRun<T> extends StoreScope {
  /** The public method this batch belongs to; named in the error it raises. */
  readonly operation: string;
  /** Which list the committed ids belong under on a thrown error. */
  readonly contextField: CommittedIdsField;
  /** The batches, already split by count and by payload size. */
  readonly batches: readonly T[][];
  /**
   * Every id this call resolved, in order, one run of them per batch. Copied on
   * entry, and reported whole as `context.attemptedIds` should a batch fail.
   */
  readonly ids: readonly string[];
  /** How many calls may be in flight at once. */
  readonly maxConcurrent: number;
  /**
   * Whether the first batch must land alone before the rest fan out.
   *
   * `true` for a write, because the first request is the one that creates the
   * index and a hundred concurrent creations of it is not a thing to do.
   * `false` for a delete, which creates nothing.
   */
  readonly serializeFirstBatch: boolean;
  /** Issue one batch's call. Its offset is the position of its first id. */
  readonly action: (batch: T[], offset: number) => Promise<void>;
}

/**
 * Run a batched operation and report what committed if it fails.
 *
 * Accepts: a {@link BatchedRun}. An empty `batches` does nothing and issues no
 * call.
 *
 * Returns: nothing. Success means every batch committed.
 *
 * Throws: the first failure, decorated with the ids that did commit under the
 * operation's own field (`writtenIds`, `deletedIds`) and with every id the
 * call attempted — but only once every batch already dispatched has settled.
 * A slower batch that succeeds *after* another has failed must never be
 * missing from that report: it committed, and a caller cleaning up needs it.
 *
 * Guarantees: ids are reported in the caller's order rather than completion
 * order, and no further batch is dispatched once one has failed. Concurrency
 * is a sliding window, so a slow call delays only the batches that need its
 * slot — the fixed groups this replaced held back every batch behind the
 * slowest member of the group.
 */
export async function runBatches<T>(opts: BatchedRun<T>): Promise<void> {
  const { operation, contextField, ids, action, batches } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };
  const attempted = [...ids];
  const committed: string[] = [];

  const idsOf = (batch: readonly T[], offset: number): string[] =>
    attempted.slice(offset, offset + batch.length);

  const fail = (error: unknown): never => {
    throw attachPartialIds(error, operation, scope, contextField, committed, attempted);
  };

  const first = opts.serializeFirstBatch ? batches[0] : undefined;
  if (first !== undefined) {
    try {
      await action([...first], 0);
    } catch (error: unknown) {
      fail(error);
    }
    committed.push(...idsOf(first, 0));
  }

  const rest = offsetBatches(
    (first === undefined ? batches : batches.slice(1)).map((batch) => [...batch]),
    first?.length ?? 0,
  );

  const window = openWindow<string[]>(opts.maxConcurrent);
  for (const { batch, offset } of rest) {
    if (window.hasFailed()) break;
    await window.launch(async () => {
      await action(batch, offset);
      return idsOf(batch, offset);
    });
  }

  const outcome = await window.settle();
  for (const batchIds of outcome.results) {
    if (batchIds !== undefined) committed.push(...batchIds);
  }
  if (outcome.failed) fail(outcome.error);
}
