import type { Document } from '@langchain/core/documents';

import { validateFilter } from '../internal/filter.js';
import { assertK, validationError } from '../internal/guards.js';
import { assertQueryVector } from '../internal/limits.js';
import type { AwsOperation } from '../internal/operation.js';
import { queryPages } from '../internal/query-pages.js';
import type { StoreScope } from '../internal/signals.js';
import { cosineRelevanceScoreFn } from '../relevance-scores.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { createDocument } from '../shared/metadata.js';
import type { DistanceMetric } from '../types.js';

export interface VectorSearchOptions extends AwsOperation {
  /** The store's metric, verified against the response before any score is computed. */
  readonly distanceMetric: DistanceMetric;
  /** The embedding to search with. */
  readonly queryVector: number[];
  /** Results wanted, an integer 1–10,000. */
  readonly k: number;
  /** A metadata filter, validated here before the request. */
  readonly filter?: unknown;
  /** Where page content is stored, so it can be lifted back out. */
  readonly pageContentMetadataKey: string | null;
}

/**
 * Search by vector, returning each document with its raw distance.
 *
 * Accepts: `k` (an integer 1–10,000) and a filter, both validated before the
 * request; the query vector, checked to be an array of 1–4,096 finite
 * components, and — on a cosine index — not the zero vector. Those are the rules
 * a *stored* vector is held to, and AWS applies them to a query too, answering
 * every one of them with the same message that names neither the component nor
 * the reason.
 *
 * Returns: `[document, distance]` pairs, nearest first, at most `k` of them.
 * Fewer than `k` is normal for a filtered search over a sparse index.
 *
 * Throws: `VALIDATION` for `k`, the vector or the filter, before any request;
 * `AWS_INVALID_RESPONSE` when a result carries no usable numeric distance;
 * otherwise whatever pagination raises.
 *
 * Guarantees: the distance is the service's own, never a substitute. A guard
 * testing only `=== undefined` let an explicit `null` through, and `1.0 - null`
 * coerces to `1.0` — the best-possible-score misranking this check exists to
 * prevent, reached by a different value. `Number.isFinite` additionally rejects
 * `NaN` and `±Infinity`, which would rank ahead of or behind everything.
 */
export async function searchByVector(opts: VectorSearchOptions): Promise<[Document, number][]> {
  const { operation } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertK(operation, scope, opts.k);
  // The same rules a stored vector is held to. All of them were probed against
  // the live service and answered identically — "Query vector contains invalid
  // values or is invalid for this index" — for a zero-norm vector, an empty one,
  // and one of the wrong length. That message names no component and no reason,
  // so the round trip bought nothing this package could not say itself, and
  // said better.
  assertQueryVector(opts.queryVector, {
    operation,
    distanceMetric: opts.distanceMetric,
    ...scope,
  });
  validateFilter(opts.filter, operation, scope);

  const outputVectors = await queryPages({
    client: opts.client,
    operation,
    distanceMetric: opts.distanceMetric,
    k: opts.k,
    queryVector: opts.queryVector,
    filter: opts.filter,
    returnMetadata: true,
    returnDistance: true,
    signal: opts.signal,
    ...scope,
  });

  return outputVectors.map((vector) => {
    if (typeof vector.distance !== 'number' || !Number.isFinite(vector.distance)) {
      throw new S3VectorsError(
        `QueryVectors response for index "${opts.indexName}" returned a result without a ` +
          'usable numeric distance, even though this call requested returnDistance: true. ' +
          'Cannot compute a reliable relevance score for it — the response may be ' +
          'malformed, come from an incompatible SDK version, or a non-conforming custom ' +
          'client.',
        S3VectorsErrorCode.AWS_INVALID_RESPONSE,
        { operation, ...scope },
      );
    }
    return [
      createDocument(vector, opts.pageContentMetadataKey, { operation, ...scope }),
      vector.distance,
    ] as [Document, number];
  });
}

/**
 * The distance-to-relevance conversion this store will use.
 *
 * Accepts: the configured `relevanceScoreFn` if there is one, the store's
 * distance metric otherwise.
 *
 * Returns: the caller's function when supplied; `cosineRelevanceScoreFn` for a
 * cosine index, which is the exact inverse of what the service returns —
 * cosine distance is `1 − cosine_similarity`
 * (`docs/evidence/cosine-distance.md`), so the score range is [−1, 1].
 *
 * Throws: `VALIDATION` for a euclidean index with no `relevanceScoreFn`.
 * Euclidean distance is unbounded above, so no fixed formula maps it to a
 * comparable score without knowing the embedding's scale — which only the
 * caller knows. Failing closed is the point: the previous heuristic divided a
 * squared distance by a linear scale and returned numbers in a narrow band
 * near 1, comparable against nothing, with no indication anything was wrong.
 */
export function selectRelevanceScoreFn(
  distanceMetric: DistanceMetric,
  scope: StoreScope,
  relevanceScoreFn?: (distance: number) => number,
): (distance: number) => number {
  if (relevanceScoreFn) return relevanceScoreFn;

  if (distanceMetric === 'euclidean') {
    throw validationError(
      'similaritySearchWithRelevanceScores',
      scope,
      'A euclidean index has no built-in relevance-score conversion: no fixed formula can map ' +
        'an unbounded euclidean distance to a comparable score without knowing your ' +
        "embedding's scale, which only you know. Supply `relevanceScoreFn` in the store " +
        'config, or use similaritySearchWithScore for raw distances.',
    );
  }
  return cosineRelevanceScoreFn;
}
