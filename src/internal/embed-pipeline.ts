/**
 * Hides that documents are embedded a batch at a time.
 *
 * Embedding everything up front is simpler and costs peak memory proportional to
 * the whole input; embedding per batch keeps it proportional to one batch, at the
 * price of interleaving the model's failures with the service's. That trade, and
 * the point at which a model's bad output is refused, live here.
 */
import { chunk, offsetBatches } from '../shared/batching.js';
import { attachPartialIds } from '../shared/errors/decorate.js';
import type { OperationScope, StoreScope } from '../shared/scope.js';
import { openWindow } from './concurrency.js';
import { requestRuns, type RecordSize } from './request-size.js';
import { checkAborted } from './signals.js';

export interface EmbedPipelineOptions<T> extends OperationScope {
  /** The items to embed and write, in caller order. */
  readonly items: readonly T[];
  /** One id per item, already resolved and validated. */
  readonly ids: string[];
  /**
   * Items per batch: one embed call each, and one write call unless the batch's
   * vectors would not fit a single request body.
   */
  readonly batchSize: number;
  /** How many writes may be un-settled at once; embedding pauses when full. */
  readonly maxConcurrent: number;
  /**
   * Cancels the run. Checked before and after every embed, because an
   * `EmbeddingsInterface` takes no signal and cannot self-cancel.
   */
  readonly signal?: AbortSignal | undefined;
  /**
   * Embed one batch, given its offset into `items` so a failure can name a
   * position in the caller's input. Never called concurrently with itself.
   */
  readonly embed: (batch: T[], offset: number) => Promise<number[][]>;
  /**
   * Write one request's worth of an embedded batch, given its offset into
   * `items`. A batch too large for one request is handed to this more than
   * once, in order.
   */
  readonly put: (batch: T[], offset: number, vectors: number[][]) => Promise<void>;
}

/**
 * Embed items batch by batch and write each batch as it is ready.
 *
 * Accepts: the items and their ids, the batch size and concurrency cap,
 * and the two side-effecting steps (`embed`, `put`) the store supplies.
 *
 * Returns: nothing on success; the caller already holds the ids.
 *
 * Throws: the first failure from either side — an `embed` that threw, an
 * abort, or a rejected `put` — carrying `context.writtenIds` (every id
 * durably written, in **input order**, regardless of the order the puts
 * completed) and `context.attemptedIds`.
 *
 * Guarantees:
 * - The **first** batch is embedded and written alone, awaited before anything
 *   else starts: it is the one that creates the index, and every later batch
 *   depends on that having happened.
 *
 * - `embed` is never called concurrently with itself. Most embedding providers
 *   rate-limit aggressively and this package gives no retry guarantee for that
 *   call, so the sequential shape is deliberate.
 * - Embedding and writing are **pipelined**: a batch's `put` is dispatched as
 *   soon as its vectors are back, and the next batch is embedded while it runs.
 *   At most `maxConcurrent` puts are un-settled at once; when the window is
 *   full, embedding pauses. This is what makes a large ingest embed-bound
 *   rather than embed-plus-put-bound.
 * - The signal is checked before **and** after every embed call: an
 *   `EmbeddingsInterface` takes no signal, so it cannot self-cancel, and a
 *   signal that fires during an embed must still stop that batch's write.
 * - No new work starts after a known failure, and the error is thrown only
 *   after every put already in flight has settled — a slower sibling that
 *   succeeds after another rejects is never missing from `writtenIds`.
 * - A batch whose embedded vectors would not fit the 20 MiB request body AWS
 *   accepts becomes several requests, each reported on its own: a failure
 *   partway through one batch still names the ids the earlier requests wrote.
 *   The dimension that decides this is not known until the batch is embedded,
 *   which is why the split lives here and not where the items were chunked.
 */
export async function embedAndWrite<T extends RecordSize>(
  opts: EmbedPipelineOptions<T>,
): Promise<void> {
  const { operation, ids, signal, embed, put } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  // The caller returns early on empty input, so there is always one batch.
  const batches = chunk([...opts.items], opts.batchSize);
  const firstBatch = batches[0]!;

  /**
   * The requests one embedded batch becomes. Only a batch whose vectors would
   * not fit the 20 MiB body limit becomes more than one, and the dimension that
   * decides it is not known until the batch has been embedded — which is why
   * this splits here rather than where the items were chunked.
   */
  const runsOf = (
    batch: T[],
    batchOffset: number,
    vectors: number[][],
  ): { records: T[]; vectors: number[][]; offset: number }[] => {
    const runs: { records: T[]; vectors: number[][]; offset: number }[] = [];
    let local = 0;
    for (const records of requestRuns(batch, vectors[0]!.length, batch.length, scope)) {
      runs.push({
        records,
        vectors: vectors.slice(local, local + records.length),
        offset: batchOffset + local,
      });
      local += records.length;
    }
    return runs;
  };

  checkAborted(operation, signal, scope);
  const writtenIds: string[] = [];
  try {
    const firstVectors = await embed(firstBatch, 0);
    // Sequentially: the first request is the one that creates the index, and
    // the ids of the requests that did land are what a failure has to report.
    for (const run of runsOf(firstBatch, 0, firstVectors)) {
      await put(run.records, run.offset, run.vectors);
      writtenIds.push(...ids.slice(run.offset, run.offset + run.records.length));
    }
  } catch (error: unknown) {
    throw attachPartialIds(error, operation, scope, 'writtenIds', writtenIds, ids);
  }

  const rest = offsetBatches(batches.slice(1), firstBatch.length);

  // The same window every other batched operation runs in. What is this
  // module's own is only that a batch is embedded while earlier ones are still
  // being written, and that an embedding failure enters the window's latch by
  // the same door a write failure does.
  const window = openWindow<string[]>(opts.maxConcurrent);

  for (const { batch, offset: batchOffset } of rest) {
    if (window.hasFailed()) break;
    let vectors: number[][];
    try {
      checkAborted(operation, signal, scope);
      vectors = await embed(batch, batchOffset);
      checkAborted(operation, signal, scope);
    } catch (error: unknown) {
      window.fail(error);
      break;
    }
    // A sibling put may have failed while this batch was being embedded.
    if (window.hasFailed()) break;
    for (const run of runsOf(batch, batchOffset, vectors)) {
      if (window.hasFailed()) break;
      await window.launch(async () => {
        await put(run.records, run.offset, run.vectors);
        return ids.slice(run.offset, run.offset + run.records.length);
      });
    }
  }

  const outcome = await window.settle();
  for (const batchIds of outcome.results) {
    if (batchIds !== undefined) writtenIds.push(...batchIds);
  }

  if (outcome.failed) {
    throw attachPartialIds(outcome.error, operation, scope, 'writtenIds', writtenIds, ids);
  }
}
