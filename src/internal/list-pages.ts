import { ListVectorsCommand } from '@aws-sdk/client-s3vectors';

import { renderValue } from '../shared/describe.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { S3OutputVector } from '../types.js';
import type { AwsOperation } from './operation.js';
import { outputVectorsOf } from './output-vectors.js';
import { checkAborted, type StoreScope, sendOptions } from './signals.js';

/**
 * "maxResults … Valid Range: Minimum value of 1. Maximum value of 1000"
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectors.html).
 * Omitted, the service applies its own default of 500.
 */
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;

/**
 * Reject a record that arrived without a usable embedding.
 *
 * Accepts: the record, and how far the listing had got.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `AWS_INVALID_RESPONSE`, carrying
 * `pagesScanned` and `yielded`.
 *
 * Guarantees: raised here rather than by the caller, because this generator owns
 * the counters. Raised from `listVectors` instead, the one failure the
 * documentation singles out was the only listing failure that could not say how
 * far it had got.
 *
 * An empty `float32` is refused as well as a missing one. `[]` satisfied a check
 * for `undefined`, so a record with no embedding at all was yielded as though it
 * had one — and the migration case `listVectors` exists for would write
 * dimensionless vectors into the target index and look complete.
 */
function assertRecordHasData(
  vector: S3OutputVector,
  scope: StoreScope,
  operation: string,
  pagesScanned: number,
  yielded: number,
): void {
  const data = vector.data?.float32;
  if (data !== undefined && data.length > 0) return;
  throw new S3VectorsError(
    `ListVectors returned vector '${vector.key}' ${
      data === undefined ? 'without data' : 'with an empty embedding'
    }, even though this call requested returnData: true. The response may be malformed, or ` +
      'come from an incompatible SDK version or a mocked/stubbed client.',
    S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    { operation, ...scope, pagesScanned, yielded },
  );
}

export interface ListPagesOptions extends AwsOperation {
  /** Whether each record should carry its embedding. */
  readonly returnData: boolean;
  /** Whether each record should carry its metadata. */
  readonly returnMetadata: boolean;
  /** 1–1000, and advisory: the 1 MB page cap may return fewer. */
  readonly pageSize?: number | undefined;
}

/**
 * Reject a page size AWS would not accept, before any request.
 *
 * @throws {S3VectorsError} `VALIDATION` for anything but `undefined` or an
 * integer 1–1000 (`maxResults` in the `ListVectors` API reference).
 */
function assertPageSize(pageSize: number | undefined, operation: string, scope: StoreScope): void {
  if (pageSize === undefined) return;
  if (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
    throw new S3VectorsError(
      `pageSize must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE} ` +
        `(received ${renderValue(pageSize)}).`,
      S3VectorsErrorCode.VALIDATION,
      { operation, ...scope },
    );
  }
}

/**
 * Explain a failed page, and say how far the listing got.
 *
 * @returns The mapped error class carrying `awsCommand: "ListVectors"`,
 * `pagesScanned` and `yielded`. A `403` also gets the one hint AWS's own
 * message omits: listing *with* metadata or data needs `s3vectors:GetVectors`
 * on top of `s3vectors:ListVectors`, which is the usual cause and is
 * impossible to guess from "Access Denied".
 */
function explainListing(
  error: unknown,
  context: { operation: string; vectorBucketName: string; indexName: string },
  pagesScanned: number,
  yielded: number,
): S3VectorsError {
  const base = wrapAwsError(error, classifyAwsError(error), 'ListVectors', context);
  const hint =
    base.code === S3VectorsErrorCode.ACCESS_DENIED
      ? ' Listing with metadata or data requires the s3vectors:GetVectors permission in ' +
        'addition to s3vectors:ListVectors.'
      : '';
  return new S3VectorsError(
    `${base.message}${hint}`,
    base.code,
    { ...base.context, pagesScanned, yielded },
    base.cause,
  );
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
 * index, and a consumer that stops iterating issues no further request. With
 * `returnData` set, every record yielded carries a non-empty `data.float32`,
 * which is what lets the caller read it without re-checking.
 *
 * Throws: `VALIDATION` for `pageSize`, before any request; `ABORTED` for
 * `signal`; `AWS_INVALID_RESPONSE` for a nullish response, for an entry that is
 * not a vector, and — when `returnData` is set — for a record carrying no
 * embedding or an empty one; otherwise the class {@link classifyAwsError}
 * assigns, carrying `awsCommand: "ListVectors"`, `pagesScanned` and `yielded` —
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
  assertPageSize(pageSize, operation, scope);

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
        sendOptions(signal),
      );
    } catch (error: unknown) {
      throw explainListing(error, { operation, ...scope }, pagesScanned, yielded);
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
    for (const vector of outputVectorsOf(response.vectors, 'ListVectors', operation, scope)) {
      if (opts.returnData) {
        assertRecordHasData(vector, scope, operation, pagesScanned, yielded);
      }
      yielded++;
      yield vector;
    }
    nextToken = response.nextToken;
  } while (nextToken);
}
