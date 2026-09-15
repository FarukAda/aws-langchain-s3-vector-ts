import { describeValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { isAbortSignalLike, type StoreScope } from './signals.js';

/** "Top-K results per QueryVectors request: Up to 10,000" (limits page). */
const MAX_TOP_K = 10_000;

/**
 * Build a `VALIDATION` error for a caller-input failure.
 *
 * Accepts: the operation to name, the scope to record, and the message.
 *
 * Returns: the error, unthrown — several callers need to throw it from inside
 * a closure or a `map`, where a helper that threw for them would lose the
 * narrowing that makes the code after the call unreachable to TypeScript.
 *
 * Throws: nothing.
 */
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
 * Accepts: anything, under the name the caller used for it.
 *
 * Returns: nothing; an array passes.
 *
 * Throws: `VALIDATION`, naming the parameter.
 *
 * Guarantees: the type system already requires an array here for a typed
 * caller, but an untyped JavaScript caller — or a cast past the types — can
 * still reach this with `null`, and without the check that surfaces as a raw,
 * uncoded `TypeError` rather than one of this package's errors.
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
 * Reject a document that is not an object before any field of it is read.
 *
 * Accepts: the resolved document list, already known to be an array.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming the position.
 *
 * Guarantees: runs before `resolveWriteIds`, which reads `doc.id`. A `null` in
 * the list surfaced there as "Cannot read properties of null (reading 'id')" —
 * a raw, uncoded escape from a package whose stated guarantee is that every
 * failure is an `S3VectorsError`.
 */
export function assertDocumentObjects(
  operation: string,
  scope: StoreScope,
  documents: readonly unknown[],
): void {
  for (let index = 0; index < documents.length; index++) {
    const document: unknown = documents[index];
    if (typeof document !== 'object' || document === null) {
      throw validationError(
        operation,
        scope,
        `Document at index ${index} is not an object (received ${describeValue(document)}). ` +
          'Every entry must be a Document, or an object with `pageContent` and optional ' +
          '`metadata`.',
      );
    }
  }
}

/**
 * Reject a non-array `ids` option before it is ever used as one.
 *
 * Accepts: `undefined` (no ids supplied; accepted) or an array.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`.
 *
 * Guarantees: shared by the write paths rather than inlined in each, because
 * the failure it prevents is silent. A string of the right length (`'abc'`
 * alongside three vectors) passes the count check, is then sliced and indexed
 * exactly like an array, and writes each *character* as a vector key — wrong
 * ids committed to AWS with no error at all.
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
 * Reject an `AbortSignal` handed to the `Callbacks` parameter slot.
 *
 * Accepts: whatever arrived in that slot — `undefined`, a `CallbackManager`, a
 * handler array, a `CallbackHandlerMethods` object, an `EventTarget`, an
 * `AbortController`, or a signal.
 *
 * Returns: nothing. Everything but a signal is accepted, including every shape
 * core actually puts there.
 *
 * Throws: `VALIDATION`, naming the fifth slot, for an `AbortSignal`.
 *
 * Guarantees: `@langchain/core` reserves the fourth argument of the text-based
 * searches for `Callbacks`, which this store accepts and ignores; the signal
 * belongs in the fifth. A signal passed fourth used to be silently discarded —
 * the search ran to completion, having spent a billable `embedQuery`, and the
 * caller's cancellation simply never happened. Silently dropping a
 * cancellation is the one outcome this package treats as unacceptable
 * elsewhere, so this fails closed and names the right slot instead.
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
 * Accepts: an integer of 1 up to this operation's AWS per-call limit — 500 for
 * `PutVectors` and `DeleteVectors`, 100 for `GetVectors` (limits page).
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming the limit.
 *
 * Guarantees: below 1 the chunking loop would never terminate; above the limit
 * the call would cost a round trip to learn the same thing from the service.
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
 * Accepts: an integer of 1 to 10,000, AWS's documented `topK` ceiling.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming the ceiling.
 *
 * Guarantees: checked before the query is embedded, so an impossible `k` never
 * costs a billable `embedQuery` call.
 */
export function assertK(operation: string, scope: StoreScope, k: number): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw validationError(operation, scope, 'k must be a positive integer');
  }
  if (k > MAX_TOP_K) {
    throw validationError(operation, scope, `k (${k}) exceeds AWS's topK limit of ${MAX_TOP_K}.`);
  }
}
