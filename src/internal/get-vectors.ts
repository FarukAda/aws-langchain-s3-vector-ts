import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';

import { chunk } from '../shared/batching.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { rebuildWithContext } from '../shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { S3OutputVector } from '../types.js';
import { assertBatchSize } from './guards.js';
import type { AwsOperation } from './operation.js';
import { outputVectorsOf } from './output-vectors.js';
import { checkAborted, type StoreScope, sendOptions } from './signals.js';

/**
 * "Vectors per GetVectors API call: Up to 100"
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html).
 */
const MAX_KEYS_PER_CALL = 100;
const DEFAULT_MAX_CONCURRENT = 10;

export interface FetchVectorsOptions extends AwsOperation {
  /** The keys to fetch. Duplicates collapse; an empty list issues no request. */
  readonly keys: readonly string[];
  /** Whether to ask for the embedding. `false` is the cheaper page. */
  readonly returnData: boolean;
  /** Whether to ask for the metadata, which is where page content lives. */
  readonly returnMetadata: boolean;
  /** Keys per request; 1–100, defaulting to the documented maximum. */
  readonly batchSize?: number | undefined;
  /** Requests in flight at once. Defaults to 10 when the caller says nothing. */
  readonly maxConcurrent?: number | undefined;
}

/**
 * Fetch one batch of keys.
 *
 * @throws {S3VectorsError} `AWS_INVALID_RESPONSE` for a nullish response —
 * raised inside the batch so it travels the same path as any other batch
 * failure. Thrown inline, it used to mask a real AWS error from a sibling.
 */
async function fetchOneBatch(
  opts: FetchVectorsOptions,
  scope: StoreScope,
  keys: string[],
): Promise<S3OutputVector[]> {
  const response = await opts.client.send(
    new GetVectorsCommand({
      vectorBucketName: opts.vectorBucketName,
      indexName: opts.indexName,
      keys,
      returnData: opts.returnData,
      returnMetadata: opts.returnMetadata,
    }),
    sendOptions(opts.signal),
  );
  if (typeof response !== 'object' || response === null) {
    throw new S3VectorsError(
      `GetVectors for index "${opts.indexName}" resolved without a response object. The ` +
        'response may be malformed, or come from an incompatible SDK version or a ' +
        'mocked/stubbed client.',
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
      { operation: opts.operation, ...scope },
    );
  }
  return outputVectorsOf(response.vectors, 'GetVectors', opts.operation, scope);
}

/**
 * Record every vector a settled group returned, and report the first failure.
 *
 * @returns The first rejection reason, or `undefined` when the whole group
 * succeeded. Every fulfilled sibling is recorded first either way: one that
 * succeeded after another rejected still retrieved its vectors, and a caller
 * retrying should not re-fetch them.
 */
function collectSettled(
  settled: PromiseSettledResult<S3OutputVector[]>[],
  found: Map<string, S3OutputVector>,
): { failed: boolean; reason: unknown } {
  let reason: unknown;
  let failed = false;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      for (const vector of result.value) found.set(vector.key, vector);
    } else if (!failed) {
      failed = true;
      reason = result.reason;
    }
  }
  return { failed, reason };
}

/**
 * Decorate a batch failure with the ids already retrieved.
 *
 * @returns The mapped error class, carrying `context.foundIds` — and saying so
 * in the message when anything was retrieved, so a log line alone shows the
 * fetch was partial. A failed request also carries `awsCommand: "GetVectors"`;
 * a sibling batch's `AWS_INVALID_RESPONSE` about a response that did arrive
 * passes through without one. Rebuilt through {@link rebuildWithContext}, so the
 * stack is still that of the failure being decorated.
 */
function withFoundIds(
  reason: unknown,
  operation: string,
  scope: StoreScope,
  found: Map<string, S3OutputVector>,
): S3VectorsError {
  const base = wrapAwsError(reason, classifyAwsError(reason), 'GetVectors', {
    operation,
    ...scope,
  });
  const foundIds = [...found.keys()];
  return rebuildWithContext(
    base,
    foundIds.length > 0
      ? `${base.message} ${foundIds.length} vector(s) were already retrieved before this ` +
          'failure — see error.context.foundIds.'
      : base.message,
    { ...base.context, foundIds },
  );
}

/**
 * Fetch vectors by key, in batches, and return them keyed by id.
 *
 * Accepts:
 * - `keys` — any number. Empty issues no request. Duplicates collapse.
 * - `returnData` — `true` when the caller needs the vectors themselves, as MMR
 *   does; `false` when metadata alone will do.
 * - `batchSize` — 1–100, checked before anything else: a caller sharing this
 *   helper (`getByIds`) may rely on the check running even when `keys` turns
 *   out empty, rather than validating it separately.
 * - `signal` — already fired rejects before any request, checked only once
 *   `batchSize` has passed.
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
 * Throws: `VALIDATION` for `batchSize`, before anything else; `ABORTED` for
 * `signal`, checked next — so an empty `keys` list with a fired signal is
 * `ABORTED`, before the empty list gets to return for free; `AWS_INVALID_RESPONSE`
 * for a nullish response; otherwise the class {@link classifyAwsError} assigns,
 * carrying `awsCommand: "GetVectors"` and `context.foundIds` — every id a
 * sibling batch retrieved before the failure, so a caller need not refetch from
 * scratch.
 */
export async function fetchVectorsByKey(
  opts: FetchVectorsOptions,
): Promise<Map<string, S3OutputVector>> {
  const { operation, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  const batchSize = opts.batchSize ?? MAX_KEYS_PER_CALL;
  assertBatchSize(operation, scope, batchSize, MAX_KEYS_PER_CALL);
  checkAborted(operation, signal, scope);

  const found = new Map<string, S3OutputVector>();
  const unique = [...new Set(opts.keys)];
  if (unique.length === 0) return found;

  for (const group of chunk(
    chunk(unique, batchSize),
    opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
  )) {
    // allSettled, not all: a slower sibling that succeeds after another
    // rejects must still appear in what gets reported.
    const settled = await Promise.allSettled(group.map((keys) => fetchOneBatch(opts, scope, keys)));
    const { failed, reason } = collectSettled(settled, found);
    if (failed) throw withFoundIds(reason, operation, scope, found);
  }

  return found;
}
