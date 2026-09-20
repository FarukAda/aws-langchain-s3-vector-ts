/**
 * Hides that absence is an ordinary answer.
 *
 * `GetVectors` returns neither an entry nor an error for an id it does not hold,
 * so the mapping from a requested list to a same-length list of slots — each one
 * a document or `undefined` — is invented here. A caller indexes the result by
 * position and never learns that the service answered with a shorter array.
 */
import type { Document } from '@langchain/core/documents';

import { fetchVectorsByIds } from '../internal/get-vectors.js';
import { assertIsArray } from '../internal/guards.js';
import { assertIdsWellFormed } from '../internal/ids.js';
import type { BatchedOperation } from '../internal/operation.js';
import { createDocument } from '../shared/metadata.js';
import type { StoreScope } from '../shared/scope.js';

export interface GetByIdsOptions extends Omit<BatchedOperation, 'operation'> {
  /** The ids to fetch, in the order the result should hold them. */
  readonly ids: string[];
  /** Where page content is stored, so it can be lifted back out. */
  readonly pageContentMetadataKey: string | null;
}

/**
 * Fetch documents by vector id.
 *
 * Accepts: the ids, a `batchSize` of 1–100, and a signal.
 *
 * Returns: **one slot per requested id, in request order**, holding the
 * document or `undefined`. Absence is an ordinary answer: `GetVectors` returns
 * neither an entry nor an error for an id that is not stored
 * (`docs/evidence/get-vectors-absent-keys.md`). Keeping the slot is what makes
 * `result[i]` always the answer for `ids[i]`, so a caller can never misalign a
 * shorter result against its id list.
 *
 * Throws: `VALIDATION` for a non-array `ids`; for an id that is not a string of
 * 1–1024 characters or not well-formed UTF-16, carrying `recordIndex` and, for a
 * string, `recordId`; or for a bad batch size — all before any request.
 * `ABORTED` for an already-fired signal, checked only once every check above
 * has passed. Otherwise whatever a failing batch raises, carrying
 * `context.foundIds`: every id already retrieved, including by a sibling batch
 * that succeeded alongside the one that failed. Unknown and absent stay
 * distinguishable: a batch that failed says nothing about whether its ids
 * exist, so those slots are not reported as `undefined`.
 *
 * Guarantees:
 * - Each document carries a deep copy of its metadata, so duplicate ids in one
 *   call yield independent documents.
 * - One order, on every call: `ids` and `batchSize` are checked before an
 *   already-fired signal gets to raise `ABORTED`, and only once both pass does
 *   an empty `ids` return `[]` — still without a request, since that
 *   short-circuit lives in {@link fetchVectorsByIds}, which this delegates to
 *   unconditionally rather than returning early itself.
 */
export async function getByIds(opts: GetByIdsOptions): Promise<(Document | undefined)[]> {
  const { ids } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertIsArray('getByIds', scope, 'ids', ids);
  // `GetVectors` holds ids to the bounds a write does, and fails the whole
  // batch — every valid id in it — on one it refuses. A repeated id is fine: it
  // collapses into one request entry and fills every slot that asked for it.
  assertIdsWellFormed(ids, { operation: 'getByIds', ...scope, source: 'the ids argument' });

  // No early return on an empty `ids` here: batchSize and the signal still
  // need checking even then, and fetchVectorsByIds already checks both ahead
  // of its own empty-keys short-circuit — running it unconditionally reuses
  // that order instead of restating it.
  const found = await fetchVectorsByIds({
    client: opts.client,
    operation: 'getByIds',
    ids,
    returnData: false,
    returnMetadata: true,
    batchSize: opts.batchSize,
    maxConcurrent: opts.maxConcurrent,
    signal: opts.signal,
    ...scope,
  });

  return ids.map((id) => {
    const vector = found.get(id);
    return vector === undefined
      ? undefined
      : createDocument(vector, opts.pageContentMetadataKey, { operation: 'getByIds', ...scope });
  });
}
