import { QueryVectorsCommand, type QueryVectorsCommandOutput } from '@aws-sdk/client-s3vectors';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { classifyAwsError } from '../shared/errors/classify.js';
import { rebuildWithContext } from '../shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { StoreScope } from '../shared/scope.js';
import type { DistanceMetric, S3OutputVector } from '../types.js';
import type { AwsOperation } from './operation.js';
import { outputVectorsOf } from './output-vectors.js';
import { checkAborted, sendOptions } from './signals.js';

/**
 * Absolute ceiling on `QueryVectors` pages per search: a runaway backstop with
 * generous headroom, not a bound on what a legitimate search needs.
 *
 * AWS publishes the page size as "Results per page in a QueryVectors response:
 * up to 100" — a maximum, not a guarantee — so a short page is a conforming
 * response and the pages needed to collect `k` is not `k / 100`. This is ten
 * times the all-pages-full minimum for the largest `k` AWS accepts.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html
 */
const MAX_QUERY_PAGES = 1_000;

export interface QueryPagesOptions extends AwsOperation {
  /** What this store believes the index uses; verified against the response. */
  readonly distanceMetric: DistanceMetric;
  /** Results wanted. Pagination continues until this many are collected. */
  readonly k: number;
  /** The embedding to search with. */
  readonly queryVector: number[];
  /** A metadata filter, already validated by the caller. */
  readonly filter?: unknown;
  /** Whether each result should carry its metadata. */
  readonly returnMetadata: boolean;
  /** Whether each result should carry its distance. MMR asks for candidates without one. */
  readonly returnDistance: boolean;
}

/**
 * Check the index's own distance metric against the one this store assumes.
 *
 * Accepts: the `distanceMetric` the response carried, and the configured one.
 *
 * Returns: nothing.
 *
 * Throws: `AWS_INVALID_RESPONSE` when the response carries nothing
 * recognisable — a positive shape check, not `=== undefined`, so an explicit
 * `null` is reported as unrecognisable rather than as a mismatch against the
 * metric "null"; `INDEX_CONFIG_MISMATCH` when the index disagrees with the
 * store.
 *
 * Guarantees: checked on the first page of every search rather than cached, so
 * an index re-created out of band with a different metric is caught on the
 * next read instead of silently scoring against the wrong one. `distanceMetric`
 * is a required response member (`QueryVectorsOutput` in
 * `@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/models_0.d.ts`), so a
 * response without it is malformed.
 */
function assertMetricMatches(
  actual: unknown,
  configured: DistanceMetric,
  operation: string,
  scope: StoreScope,
): void {
  if (actual !== 'cosine' && actual !== 'euclidean') {
    throw new S3VectorsError(
      `QueryVectors response for index "${scope.indexName}" did not include a recognisable ` +
        `distanceMetric (got ${JSON.stringify(actual)}) — cannot verify it matches this ` +
        `store's configured "${configured}". Relevance scores would be computed against ` +
        'an unverified metric.',
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
      { operation, ...scope },
    );
  }
  if (actual !== configured) {
    throw new S3VectorsError(
      `Index "${scope.indexName}" uses distance metric "${actual}", but this store is ` +
        `configured for "${configured}". Relevance scores would be computed against the ` +
        'wrong metric.',
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
      { operation, ...scope },
    );
  }
}

/**
 * Issue one `QueryVectors` page.
 *
 * Accepts: the search options, and the token the previous page returned —
 * `undefined` for the first.
 *
 * Returns: the response, unexamined. Every check on it belongs to the loop,
 * which is where the page number and the results so far are known.
 *
 * Throws: whatever the SDK raises, unwrapped. The caller adds the pagination
 * context that makes it useful.
 */
async function requestPage(
  opts: QueryPagesOptions,
  nextToken: string | undefined,
): Promise<QueryVectorsCommandOutput> {
  return await opts.client.send(
    new QueryVectorsCommand({
      vectorBucketName: opts.vectorBucketName,
      indexName: opts.indexName,
      topK: opts.k,
      nextToken,
      queryVector: { float32: opts.queryVector },
      filter: opts.filter as __DocumentType | undefined,
      returnMetadata: opts.returnMetadata,
      returnDistance: opts.returnDistance,
    }),
    sendOptions(opts.signal),
  );
}

/**
 * Run `QueryVectors`, following `nextToken` until `k` vectors are collected or
 * the result set is exhausted.
 *
 * Accepts:
 * - `k` — already validated by the caller against AWS's `topK` ceiling.
 * - `returnDistance` — `false` for a caller that needs candidates rather than
 *   scores, such as MMR. The response then carries no `distance`, which is the
 *   documented shape rather than a malformed one.
 * - `signal` — already fired rejects before any request; otherwise threaded
 *   into every page request.
 *
 * Returns: at most `k` vectors, in the order the service returned them.
 *
 * Throws: `ABORTED` for `signal`; `INDEX_CONFIG_MISMATCH` when the index's
 * metric disagrees with the store's; `AWS_INVALID_RESPONSE` for a nullish or
 * unrecognisable response; `QUERY_PAGE_LIMIT_EXCEEDED` when the page ceiling is
 * reached with pages still outstanding; otherwise the class
 * {@link classifyAwsError} assigns, carrying `awsCommand: "QueryVectors"` — an
 * `ABORTED` that cancelled a page in flight included.
 *
 * Guarantees: a short result set is returned without error when the token runs
 * out — a filtered query "may return fewer than top K results" (userguide
 * s3-vectors-metadata-filtering.html) — but never when pages remain, because
 * the two are otherwise indistinguishable to the caller. Only an empty
 * `nextToken` ends the search: an empty page carrying a token is a conforming
 * response and is followed like any other.
 */
export async function queryPages(opts: QueryPagesOptions): Promise<S3OutputVector[]> {
  const { operation, distanceMetric, k, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };
  const fail = (message: string, code: S3VectorsErrorCode): never => {
    throw new S3VectorsError(message, code, { operation, ...scope });
  };

  checkAborted(operation, signal, scope);

  const results: S3OutputVector[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    let response;
    try {
      response = await requestPage(opts, nextToken);
    } catch (error: unknown) {
      throw explainPagination(
        wrapAwsError(error, classifyAwsError(error), 'QueryVectors', { operation, ...scope }),
        pageCount,
        results.length,
        k,
      );
    }

    // The response object itself, not only its fields: a client that resolves
    // with undefined would otherwise produce a raw TypeError on the reads
    // below, breaking the guarantee that every failure is coded.
    if (typeof response !== 'object' || response === null) {
      fail(
        `QueryVectors for index "${opts.indexName}" resolved without a response object. The ` +
          'response may be malformed, or come from an incompatible SDK version or a ' +
          'mocked/stubbed client.',
        S3VectorsErrorCode.AWS_INVALID_RESPONSE,
      );
    }

    if (pageCount === 0) {
      assertMetricMatches(response.distanceMetric, distanceMetric, operation, scope);
    }

    results.push(...outputVectorsOf(response.vectors, 'QueryVectors', operation, scope));
    nextToken = response.nextToken;
    pageCount++;
  } while (nextToken && results.length < k && pageCount < MAX_QUERY_PAGES);

  if (nextToken && results.length < k) {
    throw new S3VectorsError(
      `QueryVectors for index "${opts.indexName}" stopped after ${pageCount} page(s) having ` +
        `collected ${results.length} of the ${k} requested result(s), with more pages still ` +
        `available: this library's ${MAX_QUERY_PAGES}-page ceiling was reached. Narrow the ` +
        'metadata filter or lower k.',
      S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED,
      // How far it got, so a caller can judge whether to narrow the filter or
      // lower k rather than guess.
      { operation, ...scope, pagesScanned: pageCount, resultsCollected: results.length },
    );
  }

  return results.slice(0, k);
}

/**
 * Add pagination context to a failure on a continuation page. A continuation
 * request carries a `nextToken`, which AWS documents as valid for only several
 * minutes, with re-issuing the original query as the remedy — so a
 * mid-pagination failure has an actionable cause a generic message hides.
 *
 * Keyed on a fact this library knows for certain (the failing call was a
 * continuation) rather than on an exception name: AWS publishes no dedicated
 * expired-token exception for this operation. The first page cannot have an
 * expired token, and an abort is the caller's own doing — both pass through.
 */
function explainPagination(
  base: S3VectorsError,
  pageCount: number,
  resultsCollected: number,
  k: number,
): S3VectorsError {
  if (pageCount === 0 || base.code === S3VectorsErrorCode.ABORTED) return base;
  return rebuildWithContext(
    base,
    `${base.message} This failed while fetching page ${pageCount + 1} of a paginated ` +
      `QueryVectors search, with ${resultsCollected} of the ${k} requested result(s) already ` +
      'collected. Pagination tokens stay valid for only a few minutes — if the search ran ' +
      'long, re-issue the original query to start a new pagination session.',
    { ...base.context, pagesScanned: pageCount, resultsCollected },
  );
}
