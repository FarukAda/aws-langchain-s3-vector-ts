/**
 * Hides that maximal marginal relevance costs two round trips.
 *
 * `QueryVectors` ranks by distance but returns no embeddings, and the selection
 * needs them, so the candidates are fetched again through `GetVectors`. That
 * second call, the fan-out it runs at, and the fact that the selection itself
 * comes from `@langchain/core` rather than from here are all invisible to a
 * caller, who asks for `k` documents from `fetchK` candidates.
 */
import type { Document } from '@langchain/core/documents';
import { maximalMarginalRelevance } from '@langchain/core/utils/math';

import type { ParsedFilter } from '../internal/filter.js';
import { fetchVectorsByIds } from '../internal/get-vectors.js';
import type { TopK } from '../internal/guards.js';
import { parseQueryVector } from '../internal/limits.js';
import type { AwsOperation } from '../internal/operation.js';
import { embeddingOf } from '../internal/output-vectors.js';
import { queryPages } from '../internal/query-pages.js';
import { MAX_TOP_K } from '../shared/aws-limits.js';
import { renderValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { createDocument } from '../shared/metadata.js';
import type { StoreScope } from '../shared/scope.js';
import type { DistanceMetric } from '../types.js';

declare const mmrLambda: unique symbol;

/**
 * A `lambda` that has been checked to lie in [0, 1].
 *
 * {@link resolveMmrParameters} is the only way to obtain one, exactly as it is
 * for the `k` and `fetchK` it returns beside it — so {@link mmrSearch} cannot be
 * handed a trade-off nobody checked, and does not check all three a second time
 * to be sure, which it used to.
 *
 * The brand is phantom: at run time it is the caller's own number.
 */
export type MmrLambda = number & { readonly [mmrLambda]: true };

export interface MmrSearchOptions extends AwsOperation {
  /** The store's metric, verified against the query response. */
  readonly distanceMetric: DistanceMetric;
  /** The embedding to rank against. */
  readonly queryVector: number[];
  /** Documents to return. Only {@link resolveMmrParameters} can produce one. */
  readonly k: TopK;
  /** Candidates to consider before selecting. */
  readonly fetchK: TopK;
  /**
   * 0 favours diversity entirely, 1 favours relevance entirely. Only
   * {@link resolveMmrParameters} can produce one.
   */
  readonly lambda: MmrLambda;
  /** A metadata filter, applied to the candidate query. */
  readonly filter?: ParsedFilter | undefined;
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
function assertMmrParameters(
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
 * The three numbers an MMR search runs with, resolved from the options a caller
 * gave and checked.
 *
 * Accepts: the options `maxMarginalRelevanceSearch` takes, any of `k`, `fetchK`
 * and `lambda` absent.
 *
 * Returns: all three, each absent one defaulted — `k` to 4, `fetchK` to 20,
 * `lambda` to 0.5.
 *
 * Throws: `VALIDATION`, as {@link assertMmrParameters} does, for the resolved
 * values.
 *
 * Guarantees: the one place those defaults are stated. The store's MMR search
 * resolves its options here before embedding, and a retriever resolves the
 * options it will search with here when it is built, so the two can never
 * disagree on what a missing `fetchK` means or on whether a value is allowed.
 */
export function resolveMmrParameters(
  options: { readonly k?: number; readonly fetchK?: number; readonly lambda?: number },
  operation: string,
  scope: StoreScope,
): { k: TopK; fetchK: TopK; lambda: MmrLambda } {
  const k = options.k ?? 4;
  const fetchK = options.fetchK ?? 20;
  const lambda = options.lambda ?? 0.5;
  assertMmrParameters(k, fetchK, lambda, operation, scope);
  // Branded here rather than re-checked downstream: assertMmrParameters holds
  // `k` and `fetchK` to the same 1–10,000 bound parseK does and `lambda` to
  // [0, 1], and this is the only place a caller's three numbers are resolved.
  return { k: k as TopK, fetchK: fetchK as TopK, lambda: lambda as MmrLambda };
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
 * Throws: `VALIDATION` for a query vector S3 Vectors would refuse (see
 * `parseQueryVector`), before any request — `k`, `fetchK`, `lambda` and the
 * filter arrive already checked, by the only functions that can produce them;
 * `ABORTED` for `signal`; `AWS_INVALID_RESPONSE` when a vector comes back
 * without data, or with an empty embedding, despite `returnData`; otherwise
 * whatever the underlying search and fetch raise.
 *
 * Guarantees: a candidate the search listed but the fetch no longer holds —
 * deleted between the two calls — is skipped silently. MMR is a ranking
 * heuristic and a concurrent delete is ordinary; failing the whole search
 * because one of twenty candidates vanished would make it fragile in exactly
 * the workloads that use it.
 *
 * The selection itself is `maximalMarginalRelevance` from
 * `@langchain/core/utils/math`, so this package chooses candidates rather than
 * reimplementing the algorithm. It measures diversity by cosine similarity
 * whatever the index's metric is, so a zero-norm candidate — storable on a
 * euclidean index, refused on a cosine one — scores `NaN` against the query
 * and lands somewhere undefined in the ranking. Not corrected here: the fix
 * would be this package reimplementing core's selection to special-case a
 * vector core is entitled to its own opinion about, and the documents
 * returned are real and distinct either way. It is stated on
 * `maxMarginalRelevanceSearch` instead, where a caller reads it.
 */
export async function mmrSearch(opts: MmrSearchOptions): Promise<Document[]> {
  const { operation, k, fetchK, lambda, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };
  // The rules `searchByVector` applies, which MMR skipped: the same unusable
  // embedding got a precise local error from one search method, and a bare AWS
  // rejection after a billable round trip from the other.
  const queryVector = parseQueryVector(opts.queryVector, {
    operation,
    distanceMetric: opts.distanceMetric,
    ...scope,
  });

  // No abort check of its own: `queryPages` below checks before its first
  // request, and nothing billable happens in between. A second check here
  // could not change any observable outcome — a statement that cannot be
  // observed is one more thing to keep true for no reason.
  //
  // Candidates: ids only. MMR ranks by vector, and the documents it returns
  // are built from the `GetVectors` response, which carries the metadata —
  // asking `QueryVectors` for it as well quadrupled that response for nothing.
  const candidates = await queryPages({
    client: opts.client,
    operation,
    distanceMetric: opts.distanceMetric,
    k: fetchK,
    queryVector,
    filter: opts.filter,
    returnMetadata: false,
    returnDistance: false,
    signal,
    ...scope,
  });
  if (candidates.length === 0) return [];

  const withVectors = await fetchVectorsByIds({
    client: opts.client,
    operation,
    ids: candidates.map((candidate) => candidate.key),
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

  // A candidate with no embedding is refused, empty as well as missing, by the
  // same check a listing applies: it went into the selection as though it had
  // one, and came back out of it ranked.
  const embeddings = present.map((vector) =>
    embeddingOf(vector, 'GetVectors', { operation, ...scope }),
  );

  const selected = maximalMarginalRelevance(opts.queryVector, embeddings, lambda, k);
  return selected.map((index) =>
    createDocument(present[index]!, opts.pageContentMetadataKey, { operation, ...scope }),
  );
}
