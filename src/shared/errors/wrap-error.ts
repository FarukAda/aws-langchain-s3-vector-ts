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

/**
 * Normalise an unknown thrown value into an `Error`.
 *
 * Accepts: anything. JavaScript permits throwing any value, and a signal's
 * `reason` is whatever `abort()` was given.
 *
 * Returns: the value itself when it is already Error-shaped — tested by
 * structure (`name` and `message` are strings) rather than `instanceof`, so a
 * cross-realm error passes; otherwise a new `Error` whose message is the value
 * as a string, JSON-serialised when it is not one, tolerating BigInt and
 * circular references.
 *
 * Throws: nothing. This runs inside error handling, where a second failure
 * would replace the real one.
 *
 * Guarantees: total, and non-lossy for Error-like input — the original is
 * returned, not copied, so its stack survives.
 */
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

/** The `$metadata` bag the SDK attaches to a service error. */
interface AwsMetadata {
  readonly httpStatusCode?: unknown;
  readonly requestId?: unknown;
}

type AwsDiagnostics = Pick<
  S3VectorsErrorContext,
  'awsErrorName' | 'httpStatusCode' | 'requestId' | 'retryable' | 'fieldList'
>;

/**
 * The `$metadata` an AWS SDK error carries, when it carries one.
 *
 * @returns The object, or `undefined` for anything else — a `null`, a string,
 * a missing field. Everything downstream reads through that `undefined`
 * rather than guarding again.
 */
function metadataOf(candidate: { $metadata?: unknown }): AwsMetadata | undefined {
  return typeof candidate.$metadata === 'object' && candidate.$metadata !== null
    ? candidate.$metadata
    : undefined;
}

/**
 * Whether a failed AWS call is worth retrying after a backoff.
 *
 * @returns `true` when the SDK marked it retryable, when the exception name is
 * one of the documented transient ones, or when the status is 429 or 5xx. The
 * SDK's own strategy has usually already retried these, so `true` here means
 * those attempts were exhausted.
 */
function isRetryable(
  candidate: { $retryable?: unknown },
  name: string | undefined,
  httpStatusCode: number | undefined,
): boolean {
  return (
    candidate.$retryable !== undefined ||
    (name !== undefined && RETRYABLE_AWS_ERROR_NAMES.has(name)) ||
    httpStatusCode === 429 ||
    (httpStatusCode !== undefined && httpStatusCode >= 500)
  );
}

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
    fieldList?: unknown;
  };
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  const metadata = metadataOf(candidate);
  // Nothing here came from AWS: no SDK metadata, and a name that is not one of
  // the service's exceptions. Reporting an awsErrorName and a retryability
  // verdict would invite a caller to retry a bug in their own code.
  if (metadata === undefined && !(name !== undefined && name.endsWith('Exception'))) return {};

  const out: {
    awsErrorName?: string;
    httpStatusCode?: number;
    requestId?: string;
    retryable: boolean;
    fieldList?: { path?: string; message?: string }[];
  } = { retryable: false };
  if (name !== undefined) out.awsErrorName = name;
  if (typeof metadata?.httpStatusCode === 'number') out.httpStatusCode = metadata.httpStatusCode;
  if (typeof metadata?.requestId === 'string') out.requestId = metadata.requestId;
  // Shape-checked like every other read here: a non-array is a malformed
  // response, not a field list, and passing it through would hand the caller a
  // shape the type says it cannot be.
  if (Array.isArray(candidate.fieldList)) {
    out.fieldList = candidate.fieldList as { path?: string; message?: string }[];
  }
  out.retryable = isRetryable(candidate, name, out.httpStatusCode);
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
 * Wrap an unknown AWS failure into a coded {@link S3VectorsError}.
 *
 * Accepts: any thrown value, the code to assign it (chosen by
 * `classifyAwsError`), and the context to record.
 *
 * Returns: the value unchanged when it is already an {@link S3VectorsError},
 * so the layer nearest the failure keeps ownership of its message and class;
 * otherwise a new error carrying the original as `cause`, with the AWS
 * exception name, HTTP status, request id and retryability lifted onto both
 * the message and the context — so a log line alone is enough to open an AWS
 * Support case.
 *
 * Throws: nothing.
 *
 * Guarantees: total. Every input yields an `S3VectorsError`, which is what
 * makes "no raw AWS SDK error and no bare TypeError reaches the caller" true
 * rather than aspirational.
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
