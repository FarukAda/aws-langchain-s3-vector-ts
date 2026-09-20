/**
 * Hides how a delete chooses and reaches its targets.
 *
 * A delete is either a list of ids or the whole index, and the two are not the
 * same operation underneath: one splits into `DeleteVectors` batches, the other
 * cannot be expressed as a request at all. That an absent id is a success, and
 * that a repeated one is refused here rather than by the service, are decisions
 * about what the operation means, not about how it is executed.
 */
import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';

import { runBatches } from '../internal/concurrency.js';
import { assertBatchSize, assertIsArray, validationError } from '../internal/guards.js';
import { assertIdsUnique, assertIdsWellFormed } from '../internal/ids.js';
import type { BatchedOperation } from '../internal/operation.js';
import { sendAws } from '../internal/put-batch.js';
import type { WriteRateLimiter } from '../internal/rate-limit.js';
import { checkAborted, sendOptions } from '../internal/signals.js';
import { chunk } from '../shared/batching.js';
import type { StoreScope } from '../shared/scope.js';

/** "Keys per DeleteVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
const MAX_DELETE_BATCH_SIZE = 500;
const DEFAULT_DELETE_BATCH_SIZE = 500;

export interface DeleteOptions extends Omit<BatchedOperation, 'operation'> {
  /** The vector ids to delete. Required, and never a stand-in for "all of them". */
  readonly ids: string[];
  /**
   * The store's write rate limit. `DeleteVectors` spends the same per-index
   * budget as `PutVectors` — AWS counts them together — so it waits on the
   * same limiter.
   */
  readonly rateLimit: WriteRateLimiter;
}

/**
 * Delete vectors by id.
 *
 * Accepts: the ids to delete — required — plus a batch size of 1–500 and a
 * signal.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` when `ids` is missing, is not an array, holds anything
 * that is not a 1–1024 character string or not well-formed UTF-16, repeats a
 * id, or when `deleteAll` is passed — the flag this package used to accept for
 * destroying the index, now refused with a message naming `deleteIndex()`; or
 * for a batch size outside 1–500 — all before any request. `ABORTED` for an
 * already-fired signal, checked only once every input check above has passed.
 * Otherwise the class the `DeleteVectors` failure maps to, carrying
 * `awsCommand: "DeleteVectors"` and `context.deletedIds` — every id confirmed
 * deleted before it.
 *
 * Guarantees:
 * - **This never destroys the index.** `delete` means "remove stored documents
 *   by id" in `@langchain/core`'s own description of the interface, and S3
 *   Vectors has no truncate operation, so a flag meaning "the whole index" was
 *   an invitation to destroy production data with a typo. That lives in
 *   {@link AmazonS3Vectors.deleteIndex}, which has to be named to be called.
 * - Deleting ids that are not there succeeds — AWS accepts absent keys
 *   (`docs/evidence/delete-absent.md`) — so a blind retry of the full list
 *   after an ambiguous failure is safe. Absent is not the same as malformed: a
 *   id `DeleteVectors` would refuse is refused here first.
 * - One order, on every call: every check the arguments alone decide (the
 *   `deleteAll` flag, `ids`, and batch size) runs before an already-fired
 *   signal gets to raise `ABORTED` — so an invalid call with a fired signal is
 *   `VALIDATION`, and a valid empty `ids` list with a fired signal is
 *   `ABORTED`, both before any request.
 */
export async function deleteVectors(opts: DeleteOptions): Promise<void> {
  const { ids, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  if ((opts as { deleteAll?: unknown }).deleteAll !== undefined) {
    throw validationError(
      'delete',
      scope,
      'delete() no longer takes `deleteAll`: it removes vectors by id and nothing else. ' +
        'To destroy the index — and with it its encryption configuration, tags and ' +
        'non-filterable-metadata configuration — call deleteIndex() instead.',
    );
  }
  if (ids === undefined) {
    throw validationError(
      'delete',
      scope,
      'delete() requires `ids`. It removes vectors by id; to destroy the index itself, ' +
        'call deleteIndex().',
    );
  }
  assertIsArray('delete', scope, 'ids', ids);
  // The same rules the write path applies, duplicates included. `DeleteVectors`
  // refuses a request that repeats an id — "Request must not contain duplicate
  // keys", probed live — and refuses a zero-length one, so forwarding either was
  // a round trip spent to be told what this package already knew.
  const idCheck = { operation: 'delete', ...scope, source: 'params.ids' };
  assertIdsWellFormed(ids, idCheck);
  assertIdsUnique(ids, idCheck);

  const batchSize = opts.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
  assertBatchSize('delete', scope, batchSize, MAX_DELETE_BATCH_SIZE);

  // Every check above is decided by the arguments alone; only once all of it
  // passes does an already-fired signal get to matter. `ids: []` reaches no
  // AWS call either way — chunk() over an empty list yields no groups — but it
  // must still be rejected as VALIDATION, or ABORTED for a fired signal, ahead
  // of that silent no-op.
  checkAborted('delete', signal, scope);

  await runBatches({
    batches: chunk(ids, batchSize),
    ids,
    maxConcurrent: opts.maxConcurrent,
    // A delete creates nothing, so no batch has to land before the others.
    serializeFirstBatch: false,
    operation: 'delete',
    contextField: 'deletedIds',
    ...scope,
    action: async (batchIds) => {
      // The store's write budget, spent by deletes and writes alike.
      await opts.rateLimit.acquire(batchIds.length, 'delete', scope, signal);
      await sendAws('DeleteVectors', { operation: 'delete', ...scope }, () =>
        opts.client.send(
          new DeleteVectorsCommand({
            vectorBucketName: opts.vectorBucketName,
            indexName: opts.indexName,
            keys: batchIds,
          }),
          sendOptions(signal),
        ),
      );
    },
  });
}
