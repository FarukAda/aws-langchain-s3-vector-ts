import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';

import type { StoreScope } from './signals.js';

/**
 * What any operation needs in order to name itself in an error.
 *
 * Every error this package raises carries `operation` plus the bucket and
 * index, so a failure says which call, against which index, without the caller
 * correlating a stack trace.
 */
export interface OperationScope extends StoreScope {
  /**
   * The public method this call belongs to — `'addDocuments'`,
   * `'similaritySearch'`, `'listVectors'`. It is the caller's name for the
   * operation, never an AWS command's, so an error names something the caller
   * actually wrote — on every error, one raised by a failed request included.
   * That request is named separately, as `awsCommand` (`'PutVectors'`), by the
   * site that issued it.
   */
  readonly operation: string;
}

/**
 * What any operation that issues an AWS request needs on top of that.
 */
export interface AwsOperation extends OperationScope {
  /**
   * The client every request goes through. Passed in rather than built here:
   * one store owns one client, and a caller may supply their own.
   */
  readonly client: S3VectorsClient;
  /**
   * Cancels this operation. It is threaded into every request the operation
   * issues, so an abort cancels the call in flight, and it is checked before
   * each further request, so no later one starts.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * What an operation that splits its work across several AWS calls needs.
 */
export interface BatchedOperation extends AwsOperation {
  /**
   * Items per AWS call. The per-call ceiling differs by operation — 500 for
   * `PutVectors` and `DeleteVectors`, 100 for `GetVectors` — and each
   * function's contract names its own. Below 1 or above the ceiling is
   * `VALIDATION`, before any request.
   */
  readonly batchSize?: number | undefined;
  /**
   * How many of those calls may be in flight at once. Bounds both the request
   * rate against a shared account quota and the peak payload in memory.
   */
  readonly maxConcurrent: number;
}
