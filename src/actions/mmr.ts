import type { Document } from '@langchain/core/documents';
import { maximalMarginalRelevance } from '@langchain/core/utils/math';

import { validateFilter } from '../internal/filter.js';
import { fetchVectorsByKey } from '../internal/get-vectors.js';
import type { AwsOperation } from '../internal/operation.js';
import { queryPages } from '../internal/query-pages.js';
import type { StoreScope } from '../internal/signals.js';
import { renderValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { createDocument } from '../shared/metadata.js';
import type { DistanceMetric } from '../types.js';

/** "Top-K results per QueryVectors request: Up to 10,000" (limits page). */
const MAX_TOP_K = 10_000;

export interface MmrSearchOptions extends AwsOperation {
  /** The store's metric, verified against the query response. */
  readonly distanceMetric: DistanceMetric;
  /** The embedding to rank against. */
  readonly queryVector: number[];
  /** Documents to return. */
  readonly k: number;
  /** Candidates to consider before selecting. */
  readonly fetchK: number;
  /** 0 favours diversity entirely, 1 favours relevance entirely. */
  readonly lambda: number;
  /** A metadata filter, applied to the candidate query. */
  readonly filter?: unknown;
  /** Where page content is stored, so it can be lifted back out. */
  readonly pageContentMetadataKey: string | null;
  /**
   * How many `GetVectors` calls the candidate fetch may have in flight at once.
   *
   * The store's `maxConcurrentBatchCalls`. It was not passed at all, so the
   * fetch fell back to its own default of 10 and a store configured for
   * strictly sequential calls issued ten — the cap a caller sets to bound their
   * own request rate against a shared account quota is not advisory.
   */
  readonly maxConcurrent: number;
}

/**
 * Check the three numbers MMR is steered by, before anything is spent.
 *
 * Accepts: `k` and `fetchK`, each an integer 1–10,000 (AWS's `topK` ceiling),
 * and `lambda` between 0 and 1 inclusive.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming the parameter and the range.
 *
 * Guarantees: `fetchK` below `k` is **not** an error. At most `fetchK`
 * candidates exist, so at most that many can be returned — the same
 * short-but-complete result a filtered search produces. And a `lambda` outside
 * [0, 1] is refused rather than clamped: outside that range the selection is
 * not a trade-off between relevance and diversity, it is arbitrary, and
 * silently clamping would return a ranking the caller did not ask for.
 */
export function assertMmrParameters(
  k: number,
  fetchK: number,
  lambda: number,
  operation: string,
  scope: StoreScope,
): void {
  for (const [name, value] of [
    ['k', k],
    ['fetchK', fetchK],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_TOP_K) {
      throw new S3VectorsError(
        `${name} must be an integer between 1 and ${MAX_TOP_K} (received ${renderValue(value)}).`,
        S3VectorsErrorCode.VALIDATION,
        { operation, ...scope },
      );
    }
  }
  // `typeof` first, because `>=` and `<=` coerce: comparing an object with no
  // primitive conversion throws "Cannot convert object to primitive value"
  // before any message is built, so the guard itself would fail rather than the
  // value it was guarding. `Number.isInteger` above has no such problem — it
  // answers `false` for a non-number instead of converting it.
  if (typeof lambda !== 'number' || !(lambda >= 0 && lambda <= 1)) {
    throw new S3VectorsError(
      `lambda must be between 0 and 1 (received ${renderValue(lambda)}). Outside that range the ` +
        'selection is not a trade-off between relevance and diversity.',
      S3VectorsErrorCode.VALIDATION,
      { operation, ...scope },
    );
  }
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

  assertMmrParameters(k, fetchK, lambda, operation, scope);
  validateFilter(opts.filter, operation, scope);

  // No abort check of its own: `queryPages` below checks before its first
  // request, and nothing billable happens in between. A second check here
  // could not change any observable outcome — a statement that cannot be
  // observed is one more thing to keep true for no reason.
  //
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
    maxConcurrent: opts.maxConcurrent,
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
