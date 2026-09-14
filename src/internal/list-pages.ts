import { ListVectorsCommand, type S3VectorsClient } from '@aws-sdk/client-s3vectors';

import { classifyAwsError } from '../shared/errors/classify.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { S3OutputVector } from '../types.js';
import { checkAborted, type StoreScope } from './signals.js';

/**
 * "maxResults … Valid Range: Minimum value of 1. Maximum value of 1000"
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectors.html).
 * Omitted, the service applies its own default of 500.
 */
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;

export interface ListPagesOptions extends StoreScope {
  readonly client: S3VectorsClient;
  readonly operation: string;
  readonly returnData: boolean;
  readonly returnMetadata: boolean;
  /** 1–1000, and advisory: the 1 MB page cap may return fewer. */
  readonly pageSize?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Every vector in the index, one at a time, following `nextToken`.
 *
 * Accepts:
 * - `pageSize` — 1–1000, advisory. AWS stops a page at 1 MB of processed data
 *   regardless, returning a `nextToken`, so a short page is normal.
 * - `signal` — checked before each page and threaded into the request.
 *
 * Returns: an async generator. Memory is bounded by one page however large the
 * index, and a consumer that stops iterating issues no further request.
 *
 * Throws: `VALIDATION` for `pageSize`, before any request; `ABORTED` for
 * `signal`; `AWS_INVALID_RESPONSE` for a nullish response; otherwise the class
 * {@link classifyAwsError} assigns, carrying `pagesScanned` and `yielded` —
 * items already yielded have been consumed by the caller, so this is not
 * atomic and does not pretend to be.
 *
 * Ordering is whatever the service returns; none is promised, because none is
 * documented.
 *
 * Requires `s3vectors:ListVectors` **and** `s3vectors:GetVectors`, since this
 * requests metadata: "The request fails with a 403 Forbidden error if you
 * request vector data or metadata without the s3vectors:GetVectors
 * permission" (same reference).
 */
export async function* listPages(opts: ListPagesOptions): AsyncGenerator<S3OutputVector> {
  const { client, operation, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  const pageSize = opts.pageSize;
  if (
    pageSize !== undefined &&
    (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE)
  ) {
    throw new S3VectorsError(
      `pageSize must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE} ` +
        `(received ${String(pageSize)}).`,
      S3VectorsErrorCode.VALIDATION,
      { operation, ...scope },
    );
  }

  let nextToken: string | undefined;
  let pagesScanned = 0;
  let yielded = 0;

  do {
    checkAborted(operation, signal, scope);

    let response;
    try {
      response = await client.send(
        new ListVectorsCommand({
          vectorBucketName: opts.vectorBucketName,
          indexName: opts.indexName,
          ...(pageSize === undefined ? {} : { maxResults: pageSize }),
          nextToken,
          returnData: opts.returnData,
          returnMetadata: opts.returnMetadata,
        }),
        { abortSignal: signal },
      );
    } catch (error: unknown) {
      const base = wrapAwsError(error, classifyAwsError(error), { operation, ...scope });
      const hint =
        base.code === S3VectorsErrorCode.ACCESS_DENIED
          ? ' Listing with metadata or data requires the s3vectors:GetVectors permission in ' +
            'addition to s3vectors:ListVectors.'
          : '';
      throw new S3VectorsError(
        `${base.message}${hint}`,
        base.code,
        { ...base.context, pagesScanned, yielded },
        base.cause,
      );
    }

    if (typeof response !== 'object' || response === null) {
      throw new S3VectorsError(
        `ListVectors for index "${opts.indexName}" resolved without a response object. The ` +
          'response may be malformed, or come from an incompatible SDK version or a ' +
          'mocked/stubbed client.',
        S3VectorsErrorCode.AWS_INVALID_RESPONSE,
        { operation, ...scope, pagesScanned, yielded },
      );
    }

    pagesScanned++;
    for (const vector of (response.vectors ?? []) as S3OutputVector[]) {
      yielded++;
      yield vector;
    }
    nextToken = response.nextToken;
  } while (nextToken);
}
