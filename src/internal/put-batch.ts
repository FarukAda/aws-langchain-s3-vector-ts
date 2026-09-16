import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { DocumentInterface } from '@langchain/core/documents';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { attachContext } from '../shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import { buildPutMetadata } from '../shared/metadata.js';
import type { DistanceMetric } from '../types.js';
import { assertVectorDimension, assertVectorsWritable } from './limits.js';
import type { AwsOperation } from './operation.js';
import type { StoreScope } from './signals.js';
import { sendOptions } from './signals.js';

export interface PutBatchOptions extends AwsOperation {
  /** This batch's offset into the flat input; batch 0 is the one that may create the index. */
  readonly batchOffset: number;
  /** The embeddings to write, all of one dimension. */
  readonly vectors: number[][];
  /** Their documents, positionally — one per vector. */
  readonly documents: readonly DocumentInterface[];
  /** Their ids, positionally — one per vector, already validated. */
  readonly ids: readonly string[];
  /** The store's metric; decides whether a zero vector is writable. */
  readonly distanceMetric: DistanceMetric;
  /** Where page content is stored, or `null` to store none. */
  readonly pageContentMetadataKey: string | null;
  /** Keys the index treats as non-filterable, which have the larger byte budget. */
  readonly nonFilterableKeys: readonly string[];
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
 * Validate one batch, create the index if this is the first one, and write it.
 *
 * Accepts: the vectors, their documents and ids (equal lengths, already
 * resolved by the caller), plus the store's metadata and index configuration.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` for metadata this index cannot store or a batch with no
 * usable dimension; `INDEX_CONFIG_MISMATCH` when vectors inside one batch
 * disagree on their dimension; whatever index creation raises; otherwise the
 * class the `PutVectors` failure maps to.
 *
 * Guarantees:
 * - Metadata is built and validated **before** any AWS call, so a rejected
 *   batch cannot leave a freshly created, permanently misconfigured index
 *   behind.
 * - Every batch is checked, not only the first: a caller's own inconsistent
 *   batch must never be blamed on a concurrently racing one, and a dimension
 *   mismatch inside a later batch must fail with this package's coded error
 *   rather than reaching `PutVectors`.
 * - Every vector is checked for writability, not just the first: one bad
 *   component fails the whole batch at AWS, so checking one would leave the
 *   expensive failure exactly where it was.
 * - Nothing about an existing index is validated here beyond its existence.
 *   AWS enforces the dimension on every write (userguide
 *   `s3-vectors-indexes.html`, *Dimension requirements*) and the metric is
 *   verified on every read against the `QueryVectors` response, so there is
 *   nothing left for a local check to add.
 * - A `PutVectors` that reports the index gone calls `onIndexAbsent`, so the
 *   next write re-checks and re-creates it rather than repeating the failure.
 */
export async function putBatch(opts: PutBatchOptions): Promise<void> {
  const { operation, vectors, documents, ids, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  const putVectors = vectors.map((vec, j) => {
    const doc = documents[j]!;
    const id = ids[j]!;
    const metadata = buildPutMetadata(doc, {
      pageContentMetadataKey: opts.pageContentMetadataKey,
      nonFilterableKeys: opts.nonFilterableKeys,
      operation,
      record: { recordIndex: opts.batchOffset + j, recordId: id },
      ...scope,
    });

    return {
      key: id,
      data: { float32: vec },
      metadata: metadata as __DocumentType,
    };
  });

  const firstVector = vectors[0];
  if (!firstVector || firstVector.length === 0) {
    throw new S3VectorsError(
      "Cannot determine this batch's vector dimension — the batch has no vectors, or its " +
        'first vector is empty ([]). Every vector must have at least one dimension.',
      S3VectorsErrorCode.VALIDATION,
      { operation, ...scope },
    );
  }

  for (let i = 1; i < vectors.length; i++) {
    const vector = vectors[i]!;
    if (vector.length !== firstVector.length) {
      throw new S3VectorsError(
        `Vector at index ${i} in this batch has dimension ${vector.length}, but this ` +
          `batch's first vector has dimension ${firstVector.length}. All vectors in the ` +
          'same batch must share the same dimension.',
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
        { operation, ...scope },
      );
    }
  }

  assertVectorDimension(firstVector.length, operation, scope);
  assertVectorsWritable(vectors, {
    operation,
    distanceMetric: opts.distanceMetric,
    ...scope,
  });

  // Batch 0 is awaited alone by both write paths, so later batches need no
  // check of their own.
  if (opts.batchOffset === 0 && opts.ensureIndex !== undefined) {
    await opts.ensureIndex(firstVector.length, signal);
  }

  try {
    await sendAws('PutVectors', scope, () =>
      opts.client.send(
        new PutVectorsCommand({
          vectorBucketName: opts.vectorBucketName,
          indexName: opts.indexName,
          vectors: putVectors,
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
    throw attachContext(error, operation, scope, { batchSize: putVectors.length });
  }
}
