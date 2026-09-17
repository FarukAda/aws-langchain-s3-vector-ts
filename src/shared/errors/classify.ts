import { isAbortError } from './aws-abort.js';
import { S3VectorsErrorCode } from './error-code.js';

/**
 * The name the SDK's own HTTP handler gives a request that timed out, or whose
 * connection was reset or broken: `@smithy/node-http-handler` raises it for a
 * connection, socket-idle or request timeout, and renames `ECONNRESET`, `EPIPE`
 * and `ETIMEDOUT` to it. The SDK's retry strategy classifies it as transient,
 * alongside `RequestTimeoutException` (`@smithy/core`
 * `retry/service-error-classification`, `TRANSIENT_ERROR_CODES`).
 *
 * A refused connection is not renamed. That strategy retries `ECONNREFUSED` by
 * matching the error's `code`, but the error keeps its own name, so it is not
 * this — {@link SDK_TRANSIENT_NETWORK_ERROR_CODES} matches it by `code` rather
 * than by name, as that strategy does.
 *
 * It is not a service exception, so it is not in the table below, which lists
 * exactly the exceptions the service declares.
 */
export const SDK_TIMEOUT_ERROR_NAME = 'TimeoutError';

/**
 * The Node.js system error codes the SDK's own retry strategy treats as
 * transient regardless of an error's `name` — `@smithy/core`
 * `dist-cjs/submodules/retry/index.js`, `isTransientError`, matching
 * `NODEJS_TIMEOUT_ERROR_CODES` (`ECONNRESET`, `ECONNREFUSED`, `EPIPE`,
 * `ETIMEDOUT`) and `NODEJS_NETWORK_ERROR_CODES` (`EHOSTUNREACH`, `ENETUNREACH`,
 * `ENOTFOUND`, `EAI_AGAIN`) against `error.code`.
 *
 * The same lists, not the same rule: `isTransientError` also recurses into
 * `error.cause`, to a depth of 10, so it retries a `fetch`-style
 * `TypeError` whose `cause` carries the code. This package matches only the
 * error's own `code`, so such an error stays `AWS_REQUEST_FAILED`.
 *
 * `@smithy/node-http-handler` renames only three of these eight —
 * `ECONNRESET`, `EPIPE`, `ETIMEDOUT` — to {@link SDK_TIMEOUT_ERROR_NAME}. The
 * other five, including `ECONNREFUSED`, reach this library as a plain `Error`
 * carrying the code but keeping its own `name`, which is what this set is for.
 */
const SDK_TRANSIENT_NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * Exception name to error class. Names are literal types on every exception the
 * service declares (`@aws-sdk/client-s3vectors@3.1133.0`
 * `dist-types/models/errors.d.ts`), so this lookup is exact rather than a
 * heuristic over message text.
 */
const BY_NAME: Readonly<Record<string, S3VectorsErrorCode>> = {
  TooManyRequestsException: S3VectorsErrorCode.THROTTLED,
  InternalServerException: S3VectorsErrorCode.SERVICE_UNAVAILABLE,
  RequestTimeoutException: S3VectorsErrorCode.SERVICE_UNAVAILABLE,
  ServiceUnavailableException: S3VectorsErrorCode.SERVICE_UNAVAILABLE,
  ServiceQuotaExceededException: S3VectorsErrorCode.QUOTA_EXCEEDED,
  AccessDeniedException: S3VectorsErrorCode.ACCESS_DENIED,
  ConflictException: S3VectorsErrorCode.CONFLICT,
  NotFoundException: S3VectorsErrorCode.NOT_FOUND,
  ValidationException: S3VectorsErrorCode.AWS_REJECTED,
  KmsDisabledException: S3VectorsErrorCode.KMS_ERROR,
  KmsInvalidKeyUsageException: S3VectorsErrorCode.KMS_ERROR,
  KmsInvalidStateException: S3VectorsErrorCode.KMS_ERROR,
  KmsNotFoundException: S3VectorsErrorCode.KMS_ERROR,
};

/**
 * Whether `error`'s own `code` is one of the Node.js system error codes the
 * SDK's retry strategy treats as transient, regardless of `name`.
 *
 * Accepts: any thrown value.
 *
 * Returns: `true` only when `error` is object-shaped, is not an abort — the
 * caller cancelled, so nothing failed — did not get the
 * {@link SDK_TIMEOUT_ERROR_NAME} rename, does not carry a declared service
 * exception name ({@link BY_NAME}: a service error that happens to wrap a
 * network `code` stays whatever its own name says it is), and its `code` is
 * one of {@link SDK_TRANSIENT_NETWORK_ERROR_CODES}. `false` for everything
 * else, including a non-object.
 *
 * Throws: nothing.
 *
 * Guarantees: this is the one place that precedence is decided.
 * {@link classifyAwsError}'s final branch, and `wrap-error.ts`'s
 * `isRetryable` and `awsDiagnostics`, all call this rather than re-deriving
 * any of it — so a declared exception name or an abort can never pick up
 * retryability or AWS diagnostics through the network-code path by accident,
 * even though `wrap-error.ts` sees the raw cause independently of whatever
 * code `classifyAwsError` already assigned it.
 */
export function isTransientNetworkFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === SDK_TIMEOUT_ERROR_NAME) return false;
  if (Object.hasOwn(BY_NAME, name as string)) return false;
  return typeof code === 'string' && SDK_TRANSIENT_NETWORK_ERROR_CODES.has(code);
}

/**
 * The error class an AWS failure belongs to.
 *
 * Accepts: any thrown value. A value that is not a recognised AWS exception,
 * including a non-object, yields `AWS_REQUEST_FAILED`.
 *
 * Returns: one {@link S3VectorsErrorCode}, selected by the exception's `name`.
 * An abort is classified first: the caller cancelled, so nothing failed. The
 * SDK's own {@link SDK_TIMEOUT_ERROR_NAME} is `SERVICE_UNAVAILABLE`, the class
 * of the service's own timeout. A declared service exception name always keeps
 * its own class. Only once neither of those matched is the error's `code`
 * checked against {@link SDK_TRANSIENT_NETWORK_ERROR_CODES}, so a refused,
 * reset or unreachable connection is `SERVICE_UNAVAILABLE` too — the transient
 * class, which the SDK's retry strategy puts that code in. Only the error's own
 * `code` is read, not a `cause`'s, which that strategy also reads.
 *
 * Throws: nothing.
 *
 * Guarantees: total. Every input yields a code, so no failure path can produce
 * an uncoded error.
 */
export function classifyAwsError(error: unknown): S3VectorsErrorCode {
  if (isAbortError(error)) return S3VectorsErrorCode.ABORTED;
  if (typeof error !== 'object' || error === null) return S3VectorsErrorCode.AWS_REQUEST_FAILED;
  // A non-string `name` needs no guard of its own: `Object.hasOwn` coerces the
  // key and finds nothing, so it falls through to the code check like any
  // other unrecognised value.
  const { name } = error as { name?: unknown };
  if (name === SDK_TIMEOUT_ERROR_NAME) return S3VectorsErrorCode.SERVICE_UNAVAILABLE;
  if (Object.hasOwn(BY_NAME, name as string)) return BY_NAME[name as string] as S3VectorsErrorCode;
  return isTransientNetworkFailure(error)
    ? S3VectorsErrorCode.SERVICE_UNAVAILABLE
    : S3VectorsErrorCode.AWS_REQUEST_FAILED;
}
