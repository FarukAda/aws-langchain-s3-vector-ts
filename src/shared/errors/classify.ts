import { isAbortError } from './aws-abort.js';
import { S3VectorsErrorCode } from './error-code.js';

/**
 * Exception name to error class. Names are literal types on every exception the
 * service declares (`@aws-sdk/client-s3vectors@3.1132.0`
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
 * The error class an AWS failure belongs to.
 *
 * Accepts: any thrown value. A value that is not a recognised AWS exception,
 * including a non-object, yields `AWS_REQUEST_FAILED`.
 *
 * Returns: one {@link S3VectorsErrorCode}, selected by the exception's `name`.
 * An abort is classified first: the caller cancelled, so nothing failed.
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
  // key and finds nothing, so it falls through to the catch-all like any other
  // unrecognised value.
  const { name } = error as { name?: unknown };
  return Object.hasOwn(BY_NAME, name as string)
    ? (BY_NAME[name as string] as S3VectorsErrorCode)
    : S3VectorsErrorCode.AWS_REQUEST_FAILED;
}
