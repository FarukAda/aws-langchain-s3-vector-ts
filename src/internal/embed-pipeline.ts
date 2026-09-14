import type { DocumentInterface } from '@langchain/core/documents';

import { chunk, offsetBatches } from '../shared/batching.js';
import { attachPartialIds } from '../shared/errors/decorate.js';
import { writeFirstBatch } from './concurrency.js';
import { checkAborted, type StoreScope } from './signals.js';

export interface EmbedPipelineOptions extends StoreScope {
  readonly operation: string;
  readonly documents: readonly DocumentInterface[];
  /** One id per document, already resolved and validated. */
  readonly ids: string[];
  readonly batchSize: number;
  readonly maxConcurrent: number;
  readonly signal?: AbortSignal | undefined;
  /** Embed one batch. Never called concurrently with itself. */
  readonly embed: (batch: DocumentInterface[]) => Promise<number[][]>;
  /** Write one embedded batch. Called with the batch's offset into the input. */
  readonly put: (batch: DocumentInterface[], offset: number, vectors: number[][]) => Promise<void>;
}

/**
 * Embed documents batch by batch and write each batch as it is ready.
 *
 * Accepts: the documents and their ids, the batch size and concurrency cap,
 * and the two side-effecting steps (`embed`, `put`) the store supplies.
 *
 * Returns: nothing on success; the caller already holds the ids.
 *
 * Throws: the first failure from either side — an `embed` that threw, an
 * abort, or a rejected `put` — carrying `context.writtenIds` (every id
 * durably written, in **document order**, regardless of the order the puts
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
 */
export async function embedAndWrite(opts: EmbedPipelineOptions): Promise<void> {
  const { operation, ids, signal, embed, put } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  // The caller returns early on empty input, so there is always one batch.
  const batches = chunk([...opts.documents], opts.batchSize);
  const firstBatch = batches[0]!;

  checkAborted(operation, signal, scope);
  const writtenIds = await writeFirstBatch(firstBatch, ids, operation, scope, async () => {
    await put(firstBatch, 0, await embed(firstBatch));
  });

  const rest = offsetBatches(batches.slice(1), firstBatch.length);

  const inFlight = new Set<Promise<void>>();
  /** Ids by batch index, flattened in order at the end so reports keep document order. */
  const settledIds: (string[] | undefined)[] = [];
  // The separate flag is needed because `unknown` cannot rule out a rejection
  // reason of null or undefined.
  let firstError: unknown;
  let hasError = false;
  const recordError = (error: unknown): void => {
    if (!hasError) {
      hasError = true;
      firstError = error;
    }
  };

  const launchPut = (
    batchIndex: number,
    batch: DocumentInterface[],
    batchOffset: number,
    vectors: number[][],
  ): void => {
    const tracked: Promise<void> = put(batch, batchOffset, vectors)
      .then(() => {
        settledIds[batchIndex] = ids.slice(batchOffset, batchOffset + batch.length);
      }, recordError)
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
  };

  for (let i = 0; i < rest.length && !hasError; i++) {
    const { batch, offset: batchOffset } = rest[i]!;
    let vectors: number[][];
    try {
      checkAborted(operation, signal, scope);
      vectors = await embed(batch);
      checkAborted(operation, signal, scope);
    } catch (error: unknown) {
      recordError(error);
      break;
    }
    // A sibling put may have failed while this batch was being embedded.
    if (hasError) break;
    launchPut(i, batch, batchOffset, vectors);
    if (inFlight.size >= opts.maxConcurrent) {
      // Tracked promises never reject (recordError absorbs the rejection),
      // so racing them only ever waits for one to settle.
      await Promise.race(inFlight);
    }
  }

  // Drain the window before reporting anything. Tracked promises never
  // reject, so `all` cannot throw.
  await Promise.all(inFlight);
  for (const batchIds of settledIds) {
    if (batchIds !== undefined) writtenIds.push(...batchIds);
  }

  if (hasError) {
    throw attachPartialIds(firstError, operation, scope, 'writtenIds', writtenIds, ids);
  }
}
