import { DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';

import { settleGroup } from '../internal/concurrency.js';
import { assertBatchSize, assertIsArray, validationError } from '../internal/guards.js';
import type { BatchedOperation } from '../internal/operation.js';
import { sendAws } from '../internal/put-batch.js';
import type { StoreScope } from '../internal/signals.js';
import { chunk } from '../shared/batching.js';

/** "Keys per DeleteVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
const MAX_DELETE_BATCH_SIZE = 500;
const DEFAULT_DELETE_BATCH_SIZE = 500;

export interface DeleteOptions extends Omit<BatchedOperation, 'operation'> {
  /** Vector ids to delete, or `undefined` together with `deleteAll` for the index. */
  readonly ids?: string[] | undefined;
  /** `true` deletes the index itself. Must be explicit; see the contract below. */
  readonly deleteAll: boolean;
  /** Deletes the index itself, serialising behind any creation in flight. */
  readonly deleteIndex: (signal?: AbortSignal) => Promise<void>;
}

/**
 * Delete vectors by id, or the entire index.
 *
 * Accepts: exactly one of `ids` or `deleteAll: true`.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` when both or neither are given, when `ids` is not an
 * array, or for a `batchSize` outside 1–500; otherwise the class the
 * `DeleteVectors`/`DeleteIndex` failure maps to, carrying
 * `context.deletedIds` — every id confirmed deleted before the failure.
 *
 * Guarantees:
 * - Neither argument means **nothing is deleted**. An accidentally `undefined`
 *   `ids` array would otherwise wipe the whole index, so the destructive
 *   reading has to be asked for explicitly.
 * - Both arguments is also refused rather than resolved in either direction:
 *   the two mean opposite things, and guessing which one the caller meant is
 *   not a decision this package gets to make.
 * - Deleting ids that are not there succeeds — AWS accepts absent keys
 *   (`docs/evidence/delete-absent.md`) — so a blind retry of the full list
 *   after an ambiguous failure is safe.
 * - `deleteAll` removes the **index** (`DeleteIndex`), not just its vectors:
 *   S3 Vectors has no truncate API.
 */
export async function deleteVectors(opts: DeleteOptions): Promise<void> {
  const { ids, deleteAll, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  if (ids !== undefined && deleteAll) {
    throw validationError(
      'delete',
      scope,
      'delete() cannot take both `ids` and `deleteAll: true` — pass one or the other.',
    );
  }
  if (ids === undefined && !deleteAll) {
    throw validationError(
      'delete',
      scope,
      'delete() with no `ids` would delete the entire index. Pass `{ deleteAll: true }` ' +
        'to confirm, or pass `ids` to delete specific vectors.',
    );
  }

  if (ids === undefined) {
    await opts.deleteIndex(signal);
    return;
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
