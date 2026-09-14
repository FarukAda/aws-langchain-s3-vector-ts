import { GetVectorsCommand, type S3VectorsClient } from '@aws-sdk/client-s3vectors';

import { chunk } from '../shared/batching.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { S3OutputVector } from '../types.js';
import { checkAborted, type StoreScope } from './signals.js';

/**
 * "Vectors per GetVectors API call: Up to 100"
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html).
 */
const MAX_KEYS_PER_CALL = 100;
const DEFAULT_MAX_CONCURRENT = 10;

export interface FetchVectorsOptions extends StoreScope {
  readonly client: S3VectorsClient;
  readonly operation: string;
  readonly keys: readonly string[];
  readonly returnData: boolean;
  readonly returnMetadata: boolean;
  /** Keys per request; 1–100, defaulting to the documented maximum. */
  readonly batchSize?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Fetch vectors by key, in batches, and return them keyed by id.
 *
 * Accepts:
 * - `keys` — any number. Empty issues no request. Duplicates collapse.
 * - `returnData` — `true` when the caller needs the vectors themselves, as MMR
 *   does; `false` when metadata alone will do.
 * - `signal` — already fired rejects before any request.
 *
 * Returns: a `Map` from id to vector, holding only the keys the service
 * returned. A key that does not exist is simply absent — the service omits it
 * and responds 200 (docs/evidence/get-vectors-absent-keys.md), which is what
 * lets a caller tell "not there" from "the request failed".
 *
 * A `Map` rather than an array because the response is **not** in request
 * order: `['same', 'missing', 'orth']` came back `['orth', 'same']`, reordered
 * rather than merely compacted. Any caller aligning by position would mis-pair
 * every result.
 *
 * Throws: `ABORTED` for `signal`; `AWS_INVALID_RESPONSE` for a nullish
 * response; otherwise the class {@link classifyAwsError} assigns, carrying
 * `context.foundIds` — every id a sibling batch retrieved before the failure,
 * so a caller need not refetch from scratch.
 */
export async function fetchVectorsByKey(
  opts: FetchVectorsOptions,
): Promise<Map<string, S3OutputVector>> {
  const { client, operation, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };
  checkAborted(operation, signal, scope);

  const found = new Map<string, S3OutputVector>();
  const unique = [...new Set(opts.keys)];
  if (unique.length === 0) return found;

  const batchSize = opts.batchSize ?? MAX_KEYS_PER_CALL;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_KEYS_PER_CALL) {
    throw new S3VectorsError(
      !Number.isInteger(batchSize) || batchSize < 1
        ? 'batchSize must be a positive integer'
        : `batchSize (${batchSize}) exceeds AWS's limit of ${MAX_KEYS_PER_CALL} per call for this operation.`,
      S3VectorsErrorCode.VALIDATION,
      { operation, ...scope },
    );
  }
  const batches = chunk(unique, batchSize);
  const window = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  for (const group of chunk(batches, window)) {
    // allSettled, not all: a slower sibling that succeeds after another
    // rejects must still appear in what gets reported.
    const settled = await Promise.allSettled(
      group.map(async (keys) => {
        const response = await client.send(
          new GetVectorsCommand({
            vectorBucketName: opts.vectorBucketName,
            indexName: opts.indexName,
            keys,
            returnData: opts.returnData,
            returnMetadata: opts.returnMetadata,
          }),
          { abortSignal: signal },
        );
        if (typeof response !== 'object' || response === null) {
          throw new S3VectorsError(
            `GetVectors for index "${opts.indexName}" resolved without a response object. The ` +
              'response may be malformed, or come from an incompatible SDK version or a ' +
              'mocked/stubbed client.',
            S3VectorsErrorCode.AWS_INVALID_RESPONSE,
            { operation, ...scope },
          );
        }
        return (response.vectors ?? []) as S3OutputVector[];
      }),
    );

    let firstError: unknown;
    let hasError = false;
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        for (const vector of result.value) found.set(vector.key, vector);
      } else if (!hasError) {
        hasError = true;
        firstError = result.reason;
      }
    }

    if (hasError) {
      const base = wrapAwsError(firstError, classifyAwsError(firstError), {
        operation,
        ...scope,
      });
      const foundIds = [...found.keys()];
      throw new S3VectorsError(
        foundIds.length > 0
          ? `${base.message} ${foundIds.length} vector(s) were already retrieved before this ` +
              'failure — see error.context.foundIds.'
          : base.message,
        base.code,
        { ...base.context, foundIds },
        base.cause,
      );
    }
  }

  return found;
}
