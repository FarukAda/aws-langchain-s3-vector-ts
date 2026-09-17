import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { attachContext } from '../shared/errors/decorate.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { AwsOperation } from './operation.js';
import type { WriteRecord } from './records.js';
import type { StoreScope } from './signals.js';
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
}

/**
 * Run an AWS call, surfacing any failure as a coded {@link S3VectorsError}.
 *
 * Accepts: the operation to name, the scope, and a thunk issuing the call.
 *
 * Returns: whatever the call resolved with.
 *
 * Throws: the class {@link classifyAwsError} assigns. An `AbortSignal` firing
 * before or during the call surfaces as `ABORTED` rather than a failure class —
 * it was not AWS that failed, the caller cancelled. The signal itself is
 * threaded into the request by the caller; the SDK's HTTP handler rejects an
 * already-aborted request without a network call.
 */
export async function sendAws<T>(
  operation: string,
  scope: StoreScope,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error: unknown) {
    throw wrapAwsError(error, classifyAwsError(error), { operation, ...scope });
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
 * failure maps to, carrying `batchSize` — how many vectors the failed call held.
 *
 * Guarantees:
 * - It validates nothing. Every rule on a write's input is applied to the whole
 *   input before its first batch is written (`prepareRecords`,
 *   `assertWriteVectors`), so a batch that reaches here is one AWS can take, and
 *   no rule is stated twice.
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

  try {
    await sendAws('PutVectors', scope, () =>
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
