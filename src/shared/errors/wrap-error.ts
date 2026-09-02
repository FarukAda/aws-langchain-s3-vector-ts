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
 * AWS exception names that are worth retrying after a backoff. The SDK's own
 * retry strategy has usually already retried these before the error reaches
 * this library; a caller seeing one here is looking at exhausted attempts.
 */
const RETRYABLE_AWS_ERROR_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerException',
  'InternalServerError',
  'RequestTimeout',
  'RequestTimeoutException',
]);

type AwsDiagnostics = Pick<
  S3VectorsErrorContext,
  'awsErrorName' | 'httpStatusCode' | 'requestId' | 'retryable'
>;

/**
 * Lift the fields an operator needs first — exception name, HTTP status,
 * request id, retryability — off an AWS SDK error so they sit on the
 * {@link S3VectorsErrorContext} instead of only being reachable by walking
 * `cause`. Every read is shape-checked.
 *
 * Only an AWS-shaped cause contributes anything: one carrying the SDK's
 * `$metadata`, or one whose name follows the service-exception convention
 * (`…Exception`). A plain `TypeError` from caller code, or an `AbortError`,
 * is not an AWS error and must not be presented as one.
 */
function awsDiagnostics(cause: unknown): AwsDiagnostics {
  if (typeof cause !== 'object' || cause === null) return {};
  const candidate = cause as {
    name?: unknown;
    $metadata?: unknown;
    $retryable?: unknown;
  };
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  const metadata =
    typeof candidate.$metadata === 'object' && candidate.$metadata !== null
      ? (candidate.$metadata as { httpStatusCode?: unknown; requestId?: unknown })
      : undefined;
  if (metadata === undefined && !(name !== undefined && name.endsWith('Exception'))) return {};

  const out: {
    awsErrorName?: string;
    httpStatusCode?: number;
    requestId?: string;
    retryable: boolean;
  } = { retryable: false };
  if (name !== undefined) out.awsErrorName = name;
  if (typeof metadata?.httpStatusCode === 'number') out.httpStatusCode = metadata.httpStatusCode;
  if (typeof metadata?.requestId === 'string') out.requestId = metadata.requestId;
  out.retryable =
    candidate.$retryable !== undefined ||
    (name !== undefined && RETRYABLE_AWS_ERROR_NAMES.has(name)) ||
    out.httpStatusCode === 429 ||
    (out.httpStatusCode !== undefined && out.httpStatusCode >= 500);
  return out;
}

/** Render the diagnostics as a parenthetical for the error message, or '' if there are none. */
function describeDiagnostics(diagnostics: AwsDiagnostics): string {
  const parts: string[] = [];
  if (diagnostics.awsErrorName !== undefined) parts.push(diagnostics.awsErrorName);
  if (diagnostics.httpStatusCode !== undefined) parts.push(`HTTP ${diagnostics.httpStatusCode}`);
  if (diagnostics.requestId !== undefined) parts.push(`requestId ${diagnostics.requestId}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/**
 * Wrap an unknown AWS failure into a coded {@link S3VectorsError}. An error that
 * is already an {@link S3VectorsError} is returned unchanged so the layer nearest
 * the failure keeps ownership of the message and code.
 *
 * The AWS exception name, HTTP status and request id (when the cause carries
 * them) are surfaced both in the message and on the context, so a log line
 * or an AWS Support case can be opened from the error alone.
 */
export function wrapAwsError(
  cause: unknown,
  code: S3VectorsErrorCode,
  context: S3VectorsErrorContext,
): S3VectorsError {
  if (isS3VectorsError(cause)) return cause;
  const diagnostics = awsDiagnostics(cause);
  const message = `${context.operation} failed${describeDiagnostics(diagnostics)}: ${toError(cause).message}`;
  return new S3VectorsError(message, code, { ...context, ...diagnostics }, cause);
}
