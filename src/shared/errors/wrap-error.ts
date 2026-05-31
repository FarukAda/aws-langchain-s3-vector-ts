import { S3VectorsErrorCode } from './error-code.js';
import {
  isS3VectorsError,
  S3VectorsError,
  type S3VectorsErrorContext,
} from './s3-vectors-error.js';

/** Detect a built-in Error (cross-realm safe, avoids `instanceof`). */
function isError(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Error]';
}

/** Normalize an unknown thrown value into an `Error`. */
export function toError(value: unknown): Error {
  if (isError(value)) return value as Error;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * Wrap an unknown AWS failure into a coded {@link S3VectorsError}. An error that
 * is already an {@link S3VectorsError} is returned unchanged so the layer nearest
 * the failure keeps ownership of the message and code.
 */
export function wrapAwsError(
  cause: unknown,
  code: S3VectorsErrorCode,
  context: S3VectorsErrorContext,
): S3VectorsError {
  if (isS3VectorsError(cause)) return cause as S3VectorsError;
  const message = `${context.operation} failed: ${toError(cause).message}`;
  return new S3VectorsError(message, code, context, cause);
}
