import { describeValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError, type S3VectorsErrorContext } from '../shared/errors/s3-vectors-error.js';
import { toError } from '../shared/errors/wrap-error.js';

/** The bucket and index an error should name. */
export interface StoreScope {
  /** The vector bucket the operation acts on. */
  readonly vectorBucketName: string;
  /** The index inside it. */
  readonly indexName: string;
}

/**
 * The context an error raised here records: the operation, and the bucket and
 * index — picked out by name rather than spread, because a `StoreScope` is
 * structural and a caller may hand over a wider object. The index tracker hands
 * over its own context, which also holds the SDK client, and a live client must
 * never reach an error a logger will render.
 */
function errorContext(operation: string, scope: StoreScope): S3VectorsErrorContext {
  return { operation, vectorBucketName: scope.vectorBucketName, indexName: scope.indexName };
}

/**
 * Whether a value is `AbortSignal`-shaped.
 *
 * Accepts: anything, including `null` and a value from another realm.
 *
 * Returns: `true` when the value carries a boolean `aborted` and an
 * `addEventListener` — duck-typed rather than `instanceof`, which is unreliable
 * across realms and banned here. The pair of checks is exact for the population
 * it guards: a `CallbackManager`, a handler array and a `CallbackHandlerMethods`
 * object carry no boolean `aborted`; an `EventTarget` has `addEventListener` but
 * no `aborted`; an `AbortController` has `signal` and `abort`, not `aborted`.
 *
 * Throws: nothing.
 */
export function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { aborted?: unknown; addEventListener?: unknown };
  return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

/**
 * The signal to use, or `undefined` when none was provided.
 *
 * Accepts: anything. A typed caller can only pass a signal, but this is reached
 * from untyped JavaScript, from a cast, and from config assembled at runtime.
 *
 * Returns: the signal when one was given; `undefined` for `undefined` and for
 * `null`, which means "not provided" throughout this package — the store reads
 * a `null` client and a `null` filter the same way.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` for a value that is
 * neither, naming what arrived.
 *
 * Guarantees: refused **before** the call it guards, and refused rather than
 * ignored. Both halves matter, and both were wrong in different directions: a
 * non-signal reaching `checkAborted` read `signal?.aborted`, found `undefined`,
 * and carried on — so the request ran uncancellable while the caller believed
 * otherwise — while the same value reaching `raceAbort` got as far as
 * `addEventListener` and threw a raw `TypeError`, after the AWS calls before it
 * had already been paid for. Silently uncancellable is the worse of the two:
 * dropping a cancellation is the one outcome this package refuses to do
 * quietly.
 */
function assertSignal(
  operation: string,
  signal: unknown,
  scope: StoreScope,
): AbortSignal | undefined {
  if (signal === undefined || signal === null) return undefined;
  if (isAbortSignalLike(signal)) return signal;
  throw new S3VectorsError(
    `${operation} was given a \`signal\` that is not an AbortSignal (received ` +
      `${describeValue(signal)}). The operation would have run without being cancellable. ` +
      'Pass an AbortSignal, or omit the option.',
    S3VectorsErrorCode.VALIDATION,
    errorContext(operation, scope),
  );
}

/**
 * The per-request options to hand `client.send`.
 *
 * Accepts: the signal this operation was given, or `undefined`.
 *
 * Returns: `{ abortSignal: signal }` when there is one, and an empty object when
 * there is not — rather than `{ abortSignal: undefined }`.
 *
 * Throws: nothing.
 *
 * Guarantees: the property is absent rather than present-and-undefined. The
 * SDK's `HttpHandlerOptions` declares `abortSignal` as optional but not
 * `undefined`-valued, so handing it an explicit `undefined` is a type error under
 * `exactOptionalPropertyTypes` — a flag this package claimed to build under and
 * did not. Stating the distinction once here is better than seven conditional
 * spreads at the call sites, all of which would have to agree.
 */
export function sendOptions(signal: AbortSignal | undefined): { abortSignal?: AbortSignal } {
  return signal === undefined ? {} : { abortSignal: signal };
}

/**
 * Throw `ABORTED` if `signal` has already fired.
 *
 * Accepts:
 * - `operation` — named in the message, so a caller can tell which call was
 *   cancelled.
 * - `signal` — `undefined`, `null` or a signal that has not fired returns; a
 *   signal that has fired throws; anything else is refused.
 * - `scope` — the bucket and index named in the error's context.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `ABORTED`, or `VALIDATION` for a
 * value that is not a signal (see {@link assertSignal}). The abort cause is
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
  const validated = assertSignal(operation, signal, scope);
  if (validated?.aborted !== true) return;
  throw abortError(operation, validated, scope);
}

/** The one place an `ABORTED` error is built, so both entry points agree. */
function abortError(operation: string, signal: AbortSignal, scope: StoreScope): S3VectorsError {
  return new S3VectorsError(
    `${operation} was aborted.`,
    S3VectorsErrorCode.ABORTED,
    errorContext(operation, scope),
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
 * - `signal` — `undefined` or `null` returns `factory()` directly, with no
 *   listener and no wrapper. Anything that is not a signal is refused before
 *   the factory runs, so a mistyped signal costs nothing.
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
  const validated = assertSignal(operation, signal, scope);
  if (validated === undefined) return await factory();
  checkAborted(operation, validated, scope);

  // Wrapped so a factory that throws synchronously fails the same way one
  // returning a rejected promise does.
  const work = (async () => await factory())();

  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError(operation, validated, scope));
    };
    validated.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        validated.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        validated.removeEventListener('abort', onAbort);
        reject(toError(error));
      },
    );
  });
}
