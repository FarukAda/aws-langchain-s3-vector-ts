import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import type { Document } from '@langchain/core/documents';

import { fetchVectorsByKey } from '../internal/get-vectors.js';
import { assertIsArray } from '../internal/guards.js';
import type { StoreScope } from '../internal/signals.js';
import { createDocument } from '../shared/metadata.js';

export interface GetByIdsOptions extends StoreScope {
  readonly client: S3VectorsClient;
  readonly ids: string[];
  readonly batchSize?: number | undefined;
  readonly maxConcurrent: number;
  readonly pageContentMetadataKey: string | null;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Fetch documents by vector id.
 *
 * Accepts: the ids, a `batchSize` of 1–100, and a signal.
 *
 * Returns: **one slot per requested id, in request order**, holding the
 * document or `undefined`. Absence is an ordinary answer: `GetVectors` returns
 * neither an entry nor an error for a key that is not stored
 * (`docs/evidence/get-vectors-absent-keys.md`). Keeping the slot is what makes
 * `result[i]` always the answer for `ids[i]`, so a caller can never misalign a
 * shorter result against its id list.
 *
 * Throws: `VALIDATION` for a non-array `ids` or a bad batch size; otherwise
 * whatever a failing batch raises, carrying `context.foundIds` — every id
 * already retrieved, including by a sibling batch that succeeded alongside the
 * one that failed. Unknown and absent stay distinguishable: a batch that failed
 * says nothing about whether its ids exist, so those slots are not reported as
 * `undefined`.
 *
 * Guarantees: each document carries a deep copy of its metadata, so duplicate
 * ids in one call yield independent documents.
 */
export async function getByIds(opts: GetByIdsOptions): Promise<(Document | undefined)[]> {
  const { ids } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertIsArray('getByIds', scope, 'ids', ids);
  if (ids.length === 0) return [];

  const found = await fetchVectorsByKey({
    client: opts.client,
    operation: 'getByIds',
    keys: ids,
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
      : createDocument(vector, opts.pageContentMetadataKey, 'getByIds');
  });
}
