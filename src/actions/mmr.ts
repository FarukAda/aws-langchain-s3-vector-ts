import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import type { Document } from '@langchain/core/documents';
import { maximalMarginalRelevance } from '@langchain/core/utils/math';

import { fetchVectorsByKey } from '../internal/get-vectors.js';
import { queryPages } from '../internal/query-pages.js';
import { checkAborted, type StoreScope } from '../internal/signals.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { createDocument } from '../shared/metadata.js';
import type { DistanceMetric } from '../types.js';

/** "Top-K results per QueryVectors request: Up to 10,000" (limits page). */
const MAX_TOP_K = 10_000;

export interface MmrSearchOptions extends StoreScope {
  readonly client: S3VectorsClient;
  readonly operation: string;
  readonly distanceMetric: DistanceMetric;
  readonly queryVector: number[];
  /** Documents to return. */
  readonly k: number;
  /** Candidates to consider before selecting. */
  readonly fetchK: number;
  /** 0 favours diversity entirely, 1 favours relevance entirely. */
  readonly lambda: number;
  readonly filter?: unknown;
  readonly pageContentMetadataKey: string | null;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Maximal Marginal Relevance search: relevance traded against diversity.
 *
 * Accepts:
 * - `k` and `fetchK` — each an integer 1–10,000. `fetchK` below `k` is not an
 *   error: at most `fetchK` candidates exist, so at most that many can be
 *   returned, which is the same short-but-complete result a filtered search
 *   produces.
 * - `lambda` — 0 to 1 inclusive. Outside that range the selection is not a
 *   trade-off between relevance and diversity, it is arbitrary.
 *
 * Returns: at most `k` documents, most relevant first.
 *
 * Throws: `VALIDATION` for `k`, `fetchK` or `lambda`, before any request;
 * `ABORTED` for `signal`; `AWS_INVALID_RESPONSE` when a vector comes back
 * without data despite `returnData`; otherwise whatever the underlying search
 * and fetch raise.
 *
 * Guarantees: a candidate the search listed but the fetch no longer holds —
 * deleted between the two calls — is skipped silently. MMR is a ranking
 * heuristic and a concurrent delete is ordinary; failing the whole search
 * because one of twenty candidates vanished would make it fragile in exactly
 * the workloads that use it.
 *
 * The selection itself is `maximalMarginalRelevance` from
 * `@langchain/core/utils/math`, so this package chooses candidates rather than
 * reimplementing the algorithm.
 */
export async function mmrSearch(opts: MmrSearchOptions): Promise<Document[]> {
  const { operation, k, fetchK, lambda, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };
  // Explicitly typed so a call narrows below; an inferred arrow does not
  // drive control-flow analysis even when it returns `never`.
  const fail: (message: string, code: S3VectorsErrorCode) => never = (message, code) => {
    throw new S3VectorsError(message, code, { operation, ...scope });
  };

  for (const [name, value] of [
    ['k', k],
    ['fetchK', fetchK],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_TOP_K) {
      fail(
        `${name} must be an integer between 1 and ${MAX_TOP_K} (received ${String(value)}).`,
        S3VectorsErrorCode.VALIDATION,
      );
    }
  }
  if (!(lambda >= 0 && lambda <= 1)) {
    fail(
      `lambda must be between 0 and 1 (received ${String(lambda)}). Outside that range the ` +
        'selection is not a trade-off between relevance and diversity.',
      S3VectorsErrorCode.VALIDATION,
    );
  }

  checkAborted(operation, signal, scope);

  // Candidates: keys and metadata, no scores — MMR ranks by vector, not by the
  // service's distance.
  const candidates = await queryPages({
    client: opts.client,
    operation,
    distanceMetric: opts.distanceMetric,
    k: fetchK,
    queryVector: opts.queryVector,
    filter: opts.filter,
    returnMetadata: true,
    returnDistance: false,
    signal,
    ...scope,
  });
  if (candidates.length === 0) return [];

  const withVectors = await fetchVectorsByKey({
    client: opts.client,
    operation,
    keys: candidates.map((candidate) => candidate.key),
    returnData: true,
    returnMetadata: true,
    signal,
    ...scope,
  });

  // Order follows the candidate list, not the fetch response, which is not in
  // request order (docs/evidence/get-vectors-absent-keys.md).
  const present = candidates
    .map((candidate) => withVectors.get(candidate.key))
    .filter((vector) => vector !== undefined);
  if (present.length === 0) return [];

  const embeddings = present.map((vector) => {
    const data = vector.data?.float32;
    if (data === undefined) {
      fail(
        `GetVectors returned vector '${vector.key}' without data, even though this call ` +
          'requested returnData: true. The response may be malformed, or come from an ' +
          'incompatible SDK version or a mocked/stubbed client.',
        S3VectorsErrorCode.AWS_INVALID_RESPONSE,
      );
    }
    return data;
  });

  const selected = maximalMarginalRelevance(opts.queryVector, embeddings, lambda, k);
  return selected.map((index) =>
    createDocument(present[index]!, opts.pageContentMetadataKey, operation),
  );
}
