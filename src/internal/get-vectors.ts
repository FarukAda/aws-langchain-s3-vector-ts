/**
 * Hides the shape of a `GetVectors` fan-out.
 *
 * A caller asks for any number of ids; the service takes 100 at a time. The
 * split, the requests in flight, the collapse of duplicates and the decision to
 * report what was already retrieved when one batch fails are settled here. The
 * result is a map from id to vector, which is a shape the wire never sends.
 */
import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';

import { chunk } from '../shared/batching.js';
import { rebuildWithContext } from '../shared/errors/decorate.js';
import type { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { awsFailure } from '../shared/errors/wrap-error.js';
import type { StoreScope } from '../shared/scope.js';
import type { S3OutputVector } from '../types.js';
import { openWindow } from './concurrency.js';
import { assertBatchSize } from './guards.js';
import type { AwsOperation } from './operation.js';
import { assertResponseObject, outputVectorsOf } from './output-vectors.js';
import { checkAborted, sendOptions } from './signals.js';

/**
 * "Vectors per GetVectors API call: Up to 100"
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html).
 */
const MAX_IDS_PER_CALL = 100;

export interface FetchVectorsOptions extends AwsOperation {
  /** The ids to fetch. Duplicates collapse; an empty list issues no request. */
  readonly ids: readonly string[];
  /** Whether to ask for the embedding. `false` is the cheaper page. */
  readonly returnData: boolean;
  /** Whether to ask for the metadata, which is where page content lives. */
  readonly returnMetadata: boolean;
  /** Ids per request; 1–100, defaulting to the documented maximum. */
  readonly batchSize?: number | undefined;
  /**
   * Requests in flight at once: the store's `maxConcurrentBatchCalls`.
   *
   * Required. It was optional with a default of 10, and MMR — which did not
   * pass it — issued ten requests at a time from a store configured for one.
   * A cap a caller sets to bound their own request rate is not advisory, so
   * there is no default here for a caller to fall into.
   */
  readonly maxConcurrent: number;
}

/**
 * Fetch one batch of ids.
 *
 * @throws {S3VectorsError} `AWS_INVALID_RESPONSE` for a nullish response —
 * raised inside the batch so it travels the same path as any other batch
 * failure. Thrown inline, it used to mask a real AWS error from a sibling.
 */
async function fetchOneBatch(
  opts: FetchVectorsOptions,
  scope: StoreScope,
  ids: string[],
): Promise<S3OutputVector[]> {
  const response = await opts.client.send(
    new GetVectorsCommand({
      vectorBucketName: opts.vectorBucketName,
      indexName: opts.indexName,
      // The wire field is `keys`; this package calls them ids everywhere else.
      keys: ids,
      returnData: opts.returnData,
      returnMetadata: opts.returnMetadata,
    }),
    sendOptions(opts.signal),
  );
  assertResponseObject(response, 'GetVectors', { operation: opts.operation, ...scope });
  return outputVectorsOf(response.vectors, 'GetVectors', opts.operation, scope);
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
  const base = awsFailure(reason, 'GetVectors', {
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
 * Fetch vectors by id, in batches, and return them keyed by id.
 *
 * Accepts:
 * - `ids` — any number. Empty issues no request. Duplicates collapse.
 * - `returnData` — `true` when the caller needs the vectors themselves, as MMR
 *   does; `false` when metadata alone will do.
 * - `batchSize` — 1–100, checked before anything else: a caller sharing this
 *   helper (`getByIds`) may rely on the check running even when `ids` turns
 *   out empty, rather than validating it separately.
 * - `signal` — already fired rejects before any request, checked only once
 *   `batchSize` has passed.
 *
 * Returns: a `Map` from id to vector, holding only the ids the service
 * returned. An id that does not exist is simply absent — the service omits it
 * and responds 200 (docs/evidence/get-vectors-absent-keys.md), which is what
 * lets a caller tell "not there" from "the request failed".
 *
 * A `Map` rather than an array because the response is **not** in request
 * order: `['same', 'missing', 'orth']` came back `['orth', 'same']`, reordered
 * rather than merely compacted. Any caller aligning by position would mis-pair
 * every result.
 *
 * Throws: `VALIDATION` for `batchSize`, before anything else; `ABORTED` for
 * `signal`, checked next — so an empty `ids` list with a fired signal is
 * `ABORTED`, before the empty list gets to return for free; `AWS_INVALID_RESPONSE`
 * for a nullish response; otherwise the class {@link classifyAwsError} assigns,
 * carrying `awsCommand: "GetVectors"` and `context.foundIds` — every id a
 * sibling batch retrieved before the failure, so a caller need not refetch from
 * scratch.
 *
 * Guarantees: no further batch is dispatched once one has failed, and the
 * failure is thrown only after every batch already in flight has settled — so
 * a persistent failure costs at most `maxConcurrent` requests rather than one
 * per batch, and `foundIds` is complete for everything that was dispatched.
 */
export async function fetchVectorsByIds(
  opts: FetchVectorsOptions,
): Promise<Map<string, S3OutputVector>> {
  const { operation, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  const batchSize = opts.batchSize ?? MAX_IDS_PER_CALL;
  assertBatchSize(operation, scope, batchSize, MAX_IDS_PER_CALL);
  checkAborted(operation, signal, scope);

  const found = new Map<string, S3OutputVector>();
  const unique = [...new Set(opts.ids)];
  if (unique.length === 0) return found;

  // A sliding window, not fixed groups. This was the one call site still
  // dispatching `chunk(chunk(…))` and awaiting each group with
  // `Promise.allSettled`, so one slow `GetVectors` held back every request
  // behind it until its whole group settled — `getByIds` over 10,000 ids
  // crosses ten such boundaries, and MMR with a large `fetchK` takes the same
  // route. `concurrency.ts` already said a window "is now the only one"; this
  // is the site that claim was written about.
  const window = openWindow<S3OutputVector[]>(opts.maxConcurrent);
  // No batch is launched once one has failed, exactly as on the write path.
  // This loop used to launch every one of them regardless, so that
  // `context.foundIds` named as many ids as it could — and what that bought was
  // requests that could not help: a read that was denied was denied again for
  // every batch still queued, a throttled index was sent all of them, each
  // retried by the SDK, before the caller heard anything, and a cancelled call
  // went on issuing. `foundIds` still names every id a batch already in flight
  // retrieved; what it no longer costs is the rest of the list.
  for (const batch of chunk(unique, batchSize)) {
    if (window.hasFailed()) break;
    await window.launch(async () => await fetchOneBatch(opts, scope, batch));
  }

  // Every launched batch is awaited before this resolves, so a success landing
  // after the first failure is still in `found` — which is the whole point of
  // reporting `foundIds` at all.
  const { results, failed, error } = await window.settle();
  for (const vectors of results) {
    for (const vector of vectors ?? []) found.set(vector.key, vector);
  }
  if (failed) throw withFoundIds(error, operation, scope, found);

  return found;
}
