import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { StoreScope } from './signals.js';

/** "Top-K results per QueryVectors request: Up to 10,000" (limits page). */
const MAX_TOP_K = 10_000;

/** Build a `VALIDATION` error for a caller-input failure. */
export function validationError(
  operation: string,
  scope: StoreScope,
  message: string,
): S3VectorsError {
  return new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation, ...scope });
}

/**
 * Reject a non-array before any array method is called on it.
 *
 * The type system already requires an array here for a typed caller, but an
 * untyped JavaScript caller — or a cast past the type system — can still reach
 * this with `null`, and without the check that surfaces as a raw, uncoded
 * `TypeError` instead of this package's own coded error.
 *
 * @throws {S3VectorsError} `VALIDATION`, naming the parameter
 */
export function assertIsArray(
  operation: string,
  scope: StoreScope,
  paramName: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    throw validationError(operation, scope, `${paramName} must be an array.`);
  }
}

/**
 * Reject a non-array `ids` option before it is ever used as one.
 *
 * Shared by the write methods rather than inlined in each: a string of the
 * right length (`'abc'` alongside three vectors) otherwise passes the count
 * check, is then sliced and indexed exactly like an array, and silently writes
 * each *character* as a vector key — wrong ids committed to AWS with no error
 * at all.
 *
 * @throws {S3VectorsError} `VALIDATION`
 */
export function assertIdsOption(
  operation: string,
  scope: StoreScope,
  ids: string[] | undefined,
): void {
  if (ids !== undefined) {
    assertIsArray(operation, scope, 'ids', ids);
  }
}

/**
 * True for an `AbortSignal`-shaped value.
 *
 * Duck-typed rather than `instanceof`, which is unreliable across realms and
 * banned here. The pair of checks is exact for the population it guards: a
 * `CallbackManager`, a handler array and a `CallbackHandlerMethods` object
 * carry no boolean `aborted`; an `EventTarget` has `addEventListener` but no
 * `aborted`; an `AbortController` has `signal` and `abort`, not `aborted`.
 */
function isAbortSignalLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { aborted?: unknown; addEventListener?: unknown };
  return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

/**
 * Reject an `AbortSignal` handed to the `Callbacks` parameter slot.
 *
 * `@langchain/core`'s `VectorStore` reserves the fourth argument of the
 * text-based searches for `Callbacks`, which this store accepts and ignores;
 * the `AbortSignal` belongs in the fifth. A signal passed fourth was silently
 * discarded — the search ran to completion, having spent a billable
 * `embedQuery` call, and the caller's cancellation simply never happened.
 *
 * Silently dropping a cancellation is the one outcome this package treats as
 * unacceptable elsewhere (it refuses to guess at a missing distance, and
 * refuses to return a short result set), so this fails closed and names the
 * right slot instead.
 *
 * @throws {S3VectorsError} `VALIDATION`, naming the fifth slot
 */
export function rejectSignalInCallbacksSlot(
  operation: string,
  scope: StoreScope,
  value: unknown,
): void {
  if (isAbortSignalLike(value)) {
    throw validationError(
      operation,
      scope,
      'An AbortSignal was passed as the 4th argument, which is the Callbacks slot — it ' +
        'would be ignored and the search would run uncancelled. Pass the signal as the 5th ' +
        `argument instead: ${operation}(query, k, filter, undefined, signal).`,
    );
  }
}

/**
 * Reject a batch size that cannot work, before it costs anything.
 *
 * Below 1 it would drive an infinite loop; above AWS's per-call limit it would
 * cost a round trip to learn the same thing from the service.
 *
 * @throws {S3VectorsError} `VALIDATION`
 */
export function assertBatchSize(
  operation: string,
  scope: StoreScope,
  batchSize: number,
  max: number,
): void {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw validationError(operation, scope, 'batchSize must be a positive integer');
  }
  if (batchSize > max) {
    throw validationError(
      operation,
      scope,
      `batchSize (${batchSize}) exceeds AWS's limit of ${max} per call for this operation.`,
    );
  }
}

/**
 * Reject a `k` that cannot work, before it costs anything.
 *
 * Below 1 it would drive pointless pagination; above AWS's documented `topK`
 * ceiling it would cost a round trip to learn the same thing from the service.
 *
 * @throws {S3VectorsError} `VALIDATION`
 */
export function assertK(operation: string, scope: StoreScope, k: number): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw validationError(operation, scope, 'k must be a positive integer');
  }
  if (k > MAX_TOP_K) {
    throw validationError(operation, scope, `k (${k}) exceeds AWS's topK limit of ${MAX_TOP_K}.`);
  }
}
