/**
 * Hides what an operation needs in order to issue a request.
 *
 * The client, the cancellation signal, the batch size and the fan-out bound
 * travel together because every AWS call here needs the same four things. They
 * are one type rather than four parameters so that adding a fifth is a change to
 * this file, not to every signature between the store and the wire.
 */
import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';

import type { OperationScope } from '../shared/scope.js';

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
