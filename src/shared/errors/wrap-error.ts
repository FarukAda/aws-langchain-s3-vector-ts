import { S3VectorsErrorCode } from './error-code.js';
import {
  isS3VectorsError,
  S3VectorsError,
  type S3VectorsErrorContext,
} from './s3-vectors-error.js';

/** Detect an Error-like value by structure (cross-realm safe, avoids `instanceof`). */
function isError(value: unknown): value is Error {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { message?: unknown; name?: unknown };
  return typeof candidate.name === 'string' && typeof candidate.message === 'string';
}

/** Stringify a value for an error message, tolerating BigInt and circular references. */
function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value, (_key: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/** Normalize an unknown thrown value into an `Error`. */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  return new Error(typeof value === 'string' ? value : safeStringify(value));
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
  if (isS3VectorsError(cause)) return cause;
  const message = `${context.operation} failed: ${toError(cause).message}`;
  return new S3VectorsError(message, code, context, cause);
}
