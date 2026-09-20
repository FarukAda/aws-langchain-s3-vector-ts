/**
 * Hides how one write request is issued and what its failure means.
 *
 * The command, the send options that carry cancellation, and the mapping from a
 * thrown SDK error to this package's error class are one step. Keeping them
 * together is what lets a 503 from `PutVectors` — which AWS also returns for a
 * batch that exceeds resource capacity — be read as the capacity signal it is
 * rather than as a transient failure worth retrying.
 */
import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { attachContext } from '../shared/errors/decorate.js';
import { awsFailure, type AwsCommand } from '../shared/errors/wrap-error.js';
import type { OperationScope, StoreScope } from '../shared/scope.js';
import type { AwsOperation } from './operation.js';
import type { WriteRateLimiter } from './rate-limit.js';
import type { WriteRecord } from './records.js';
import { sendOptions } from './signals.js';

export interface PutBatchOptions extends AwsOperation {
  /** This batch's offset into the caller's input; batch 0 is the one that may create the index. */
  readonly batchOffset: number;
  /** The records to write, built and validated for the whole input by `prepareRecords`. */
  readonly records: readonly WriteRecord[];
  /** One embedding per record, in the same order, validated by `assertWriteVectors`. */
  readonly vectors: readonly number[][];
  /** Called for batch 0 only, and only when the store may create an index. */
  readonly ensureIndex?: ((dimension: number, signal?: AbortSignal) => Promise<void>) | undefined;
  /** Called when a write reports the index gone, so the next write re-checks. */
  readonly onIndexAbsent: () => void;
  /** The store's write rate limit, waited on before the request is sent. */
  readonly rateLimit: WriteRateLimiter;
}

/**
 * Run an AWS call, surfacing any failure as a coded {@link S3VectorsError}.
 *
 * Accepts: the S3 Vectors API operation the thunk issues (`"PutVectors"`), the
 * public method and scope to name, and a thunk issuing the call.
 *
 * Returns: whatever the call resolved with.
 *
 * Throws: the class {@link classifyAwsError} assigns, naming the public method
 * as `operation` and the request as `awsCommand`. An `AbortSignal` firing
 * before or during the call surfaces as `ABORTED` rather than a failure class —
 * it was not AWS that failed, the caller cancelled. The signal itself is
 * threaded into the request by the caller; the SDK's HTTP handler rejects an
 * already-aborted request without a network call.
 */
export async function sendAws<T>(
  awsCommand: AwsCommand,
  context: OperationScope,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error: unknown) {
    throw awsFailure(error, awsCommand, context);
  }
}

/**
 * Write one batch, creating the index first if this is batch 0.
 *
 * Accepts: equal-length records and vectors — both already validated, every
 * vector of one dimension — the batch's offset, and the index hooks.
 *
 * Returns: nothing.
 *
 * Throws: whatever index creation raises; otherwise the class the `PutVectors`
 * failure maps to, carrying `awsCommand: "PutVectors"` and `batchSize` — how
 * many vectors the failed call held.
 *
 * Guarantees:
 * - It validates nothing. Every rule on a write's input is applied to the whole
 *   input before its first batch is written (`prepareRecords`,
 *   `assertWriteVectors`), so a batch that reaches here breaks no rule this
 *   package can check locally, and no rule is stated twice.
 * - Batch 0 ensures the index exists, at the dimension of its first vector,
 *   before writing.
 * - Nothing about an existing index is validated here beyond its existence. AWS
 *   enforces the dimension on every write (userguide `s3-vectors-indexes.html`,
 *   *Dimension requirements*) and the metric is verified on every read against
 *   the `QueryVectors` response, so there is nothing left for a local check to add.
 * - A `PutVectors` that reports the index gone calls `onIndexAbsent`, so the
 *   next write re-checks and re-creates it rather than repeating the failure.
 */
export async function putBatch(opts: PutBatchOptions): Promise<void> {
  const { operation, records, vectors, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  // Batch 0 is awaited alone by both write paths, so later batches need no
  // check of their own.
  if (opts.batchOffset === 0 && opts.ensureIndex !== undefined) {
    await opts.ensureIndex(vectors[0]!.length, signal);
  }

  // After the index is ensured — creating one is a control-plane call, and the
  // rate this waits on is the data plane's.
  await opts.rateLimit.acquire(records.length, operation, scope, signal);

  try {
    await sendAws('PutVectors', { operation, ...scope }, () =>
      opts.client.send(
        new PutVectorsCommand({
          vectorBucketName: opts.vectorBucketName,
          indexName: opts.indexName,
          vectors: records.map((record, index) => ({
            key: record.key,
            data: { float32: vectors[index]! },
            metadata: record.metadata as __DocumentType,
          })),
        }),
        sendOptions(signal),
      ),
    );
  } catch (error: unknown) {
    if (isAwsNotFoundException((error as { cause?: unknown }).cause)) {
      opts.onIndexAbsent();
    }
    // The batch size travels with the failure: a 503 here may mean the batch
    // exceeded capacity rather than that the service is unavailable, and
    // nothing else in the error separates those.
    throw attachContext(error, operation, scope, { batchSize: records.length });
  }
}
