import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { toError } from '../shared/errors/wrap-error.js';

/** The bucket and index an error should name. */
export interface StoreScope {
  readonly vectorBucketName: string;
  readonly indexName: string;
}

/**
 * Throw `ABORTED` if `signal` has already fired.
 *
 * Accepts:
 * - `operation` — named in the message, so a caller can tell which call was
 *   cancelled.
 * - `signal` — `undefined` or a signal that has not fired returns; a signal that
 *   has fired throws.
 * - `scope` — the bucket and index named in the error's context.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `ABORTED`. The cause is
 * `signal.reason` normalised through `toError`, so it is always an `Error` —
 * `AbortController.abort()` defaults the reason to a `DOMException`, which
 * passes through unchanged, but `abort(anything)` may set it to a string or a
 * plain object.
 */
export function checkAborted(
  operation: string,
  signal: AbortSignal | undefined,
  scope: StoreScope,
): void {
  if (!signal?.aborted) return;
  throw abortError(operation, signal, scope);
}

/** The one place an `ABORTED` error is built, so both entry points agree. */
function abortError(operation: string, signal: AbortSignal, scope: StoreScope): S3VectorsError {
  return new S3VectorsError(
    `${operation} was aborted.`,
    S3VectorsErrorCode.ABORTED,
    { operation, ...scope },
    toError(signal.reason),
  );
}

/**
 * Let `signal` end *this* caller's wait without cancelling the work itself.
 *
 * Accepts:
 * - `factory` — called at most once, and **not at all** if the signal has
 *   already fired. A factory rather than a promise is what makes that
 *   possible: a promise argument would already have dispatched its billable
 *   call before this function could refuse it.
 * - `signal` — `undefined` returns `factory()` directly, with no listener and
 *   no wrapper.
 * - `operation`, `scope` — named in the `ABORTED` error.
 *
 * Returns: whatever the factory's promise resolves to, if it settles first.
 *
 * Throws: `ABORTED` if the signal fires first; otherwise the factory's own
 * failure, normalised through `toError` so a caller always catches an `Error`.
 *
 * Guarantees: the abort listener is removed on both settle paths, so many
 * waits on one signal leave none behind. A failure arriving after the caller
 * has already aborted is still observed and never becomes an unhandled
 * rejection. The underlying work keeps running for whoever else awaits it —
 * that is the whole point: a shared index creation, or a request other callers
 * depend on, is not one caller's to cancel.
 */
export async function raceAbort<T>(
  factory: () => Promise<T>,
  signal: AbortSignal | undefined,
  operation: string,
  scope: StoreScope,
): Promise<T> {
  if (signal === undefined) return await factory();
  checkAborted(operation, signal, scope);

  // Wrapped so a factory that throws synchronously fails the same way one
  // returning a rejected promise does.
  const work = (async () => await factory())();

  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError(operation, signal, scope));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(toError(error));
      },
    );
  });
}
