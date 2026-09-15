import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';

import { settleGroup } from '../internal/concurrency.js';
import { assertBatchSize, assertIsArray, validationError } from '../internal/guards.js';
import type { BatchedOperation } from '../internal/operation.js';
import { sendAws } from '../internal/put-batch.js';
import { checkAborted } from '../internal/signals.js';
import type { StoreScope } from '../internal/signals.js';
import { chunk } from '../shared/batching.js';

/** "Keys per DeleteVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
const MAX_DELETE_BATCH_SIZE = 500;
const DEFAULT_DELETE_BATCH_SIZE = 500;

export interface DeleteOptions extends Omit<BatchedOperation, 'operation'> {
  /** The vector ids to delete. Required, and never a stand-in for "all of them". */
  readonly ids: string[];
}

/**
 * Delete vectors by id.
 *
 * Accepts: the ids to delete — required — plus a batch size of 1–500 and a
 * signal.
 *
 * Returns: nothing.
 *
 * Throws: `ABORTED` for an already-fired signal, before any request;
 * `VALIDATION` when `ids` is missing, is not an array, or when `deleteAll` is
 * passed — the flag this package used to accept for destroying the index, now
 * refused with a message naming `deleteIndex()`; `VALIDATION` for a batch size
 * outside 1–500; otherwise the class the `DeleteVectors` failure maps to,
 * carrying `context.deletedIds` — every id confirmed deleted before it.
 *
 * Guarantees:
 * - **This never destroys the index.** `delete` means "remove stored documents
 *   by id" in `@langchain/core`'s own description of the interface, and S3
 *   Vectors has no truncate operation, so a flag meaning "the whole index" was
 *   an invitation to destroy production data with a typo. That lives in
 *   {@link AmazonS3Vectors.deleteIndex}, which has to be named to be called.
 * - Deleting ids that are not there succeeds — AWS accepts absent keys
 *   (`docs/evidence/delete-absent.md`) — so a blind retry of the full list
 *   after an ambiguous failure is safe.
 */
export async function deleteVectors(opts: DeleteOptions): Promise<void> {
  const { ids, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  checkAborted('delete', signal, scope);

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

  const batchSize = opts.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
  assertBatchSize('delete', scope, batchSize, MAX_DELETE_BATCH_SIZE);

  const deletedIds: string[] = [];
  for (const group of chunk(chunk(ids, batchSize), opts.maxConcurrent)) {
    await settleGroup(
      group.map(
        (batchIds) => () =>
          sendAws('DeleteVectors', scope, () =>
            opts.client.send(
              new DeleteVectorsCommand({
                vectorBucketName: opts.vectorBucketName,
                indexName: opts.indexName,
                keys: batchIds,
              }),
              { abortSignal: signal },
            ),
          ).then(() => batchIds),
      ),
      { operation: 'delete', key: 'deletedIds', ...scope },
      deletedIds,
    );
  }
}
