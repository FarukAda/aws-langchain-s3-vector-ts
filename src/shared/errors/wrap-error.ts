/**
 * Hides the boundary between a failure and this package's account of it.
 *
 * Anything can be thrown: an SDK error, a caller's embeddings model, a string.
 * Turning any of them into one error class — with the right code, the command
 * that failed, and a message that survives being read by someone who has never
 * seen this code — happens here, and the rules differ for a failure this package
 * caused and one a caller's own code did.
 */
import { renderValue } from '../describe.js';
import { classifyAwsError, isTransientNetworkFailure, SDK_TIMEOUT_ERROR_NAME } from './classify.js';
import { S3VectorsErrorCode } from './error-code.js';
import {
  isS3VectorsError,
  S3VectorsError,
  type S3VectorsErrorContext,
} from './s3-vectors-error.js';

/**
 * The S3 Vectors API operations this package issues: every value
 * `context.awsCommand` can take. A parameter typed this way turns a misspelt
 * command at a request site into a compile error. The public field stays
 * `string`, as `S3VectorsErrorContext` documents it.
 */
export type AwsCommand =
  | 'GetIndex'
  | 'CreateIndex'
  | 'DeleteIndex'
  | 'GetVectorBucket'
  | 'PutVectors'
  | 'DeleteVectors'
  | 'QueryVectors'
  | 'GetVectors'
  | 'ListVectors';

/** Detect an Error-like value by structure (cross-realm safe, avoids `instanceof`). */
function isError(value: unknown): value is Error {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { message?: unknown; name?: unknown };
  return typeof candidate.name === 'string' && typeof candidate.message === 'string';
}

/**
 * Stringify a value for an error message, tolerating BigInt and circular
 * references — and never throwing.
 *
 * `String()` is not the fallback it looks like: on an object with a null
 * prototype, or one whose `toString` throws, it raises "Cannot convert object to
 * primitive value". Reached from `toError`, which is documented as throwing
 * nothing and runs inside error handling, that would replace the failure being
 * reported with a failure to describe it. `renderValue` cannot throw.
 */
function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value, (_key: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    return json === undefined ? renderValue(value) : json;
  } catch {
    return renderValue(value);
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
 * AWS exception names worth retrying after a backoff. The SDK's own retry
 * strategy has usually already retried these before the error reaches this
 * library, so a caller seeing one here is looking at exhausted attempts.
 *
 * Every name is one S3 Vectors actually declares, checked against the SDK's own
 * exports by `test/contract/aws-error-names.test.ts`. Three that it does not —
 * `ThrottlingException`, `InternalServerError` and `RequestTimeout` — used to
 * sit here, which is harmless in a set that is only ever read, and not harmless
 * in the prose that named them to callers as something they would see.
 */
const RETRYABLE_AWS_ERROR_NAMES = new Set([
  // Raised by the SDK's own HTTP handler when a socket goes idle past
  // `socketTimeout`, or a request past `requestTimeout`. Waiting again is
  // exactly what might work, so it is retryable.
  SDK_TIMEOUT_ERROR_NAME,
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerException',
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
 * @param isTransientNetwork Whether {@link isTransientNetworkFailure} already
 * said the cause is a refused, reset or unreachable connection — computed
 * once by the caller (`awsDiagnostics`), which alone knows whether the
 * network-code rule applies here at all (an AWS request site) or not (caller
 * code). Taking the verdict rather than the raw cause is what keeps this
 * function from being a second place that rule could be mis-applied.
 *
 * @returns `true` when the SDK marked it retryable, when the exception name is
 * one of the documented transient ones, when the status is 429 or 5xx, or when
 * `isTransientNetwork` is `true`. The SDK's own strategy has usually already
 * retried these, so `true` here means those attempts were exhausted.
 */
function isRetryable(
  candidate: { $retryable?: unknown },
  name: string | undefined,
  httpStatusCode: number | undefined,
  isTransientNetwork: boolean,
): boolean {
  return (
    candidate.$retryable !== undefined ||
    (name !== undefined && RETRYABLE_AWS_ERROR_NAMES.has(name)) ||
    httpStatusCode === 429 ||
    (httpStatusCode !== undefined && httpStatusCode >= 500) ||
    isTransientNetwork
  );
}

/**
 * Whether a value is the web platform's `DOMException`.
 *
 * Accepts: any object.
 *
 * Returns: `true` for a `DOMException` from any realm, recognised by its
 * built-in tag rather than `instanceof`, which is unreliable across realms and
 * banned here.
 *
 * Throws: nothing. Reading the tag runs a getter the value may have replaced,
 * and this is called from inside error handling, where a second failure would
 * replace the one being reported — so a getter that throws is read as "no".
 */
function isDomException(value: object): boolean {
  try {
    return Object.prototype.toString.call(value) === '[object DOMException]';
  } catch {
    return false;
  }
}

/**
 * Lift the fields an operator needs first — exception name, HTTP status,
 * request id, retryability — off an AWS SDK error so they sit on the
 * {@link S3VectorsErrorContext} instead of only being reachable by walking
 * `cause`. Every read is shape-checked.
 *
 * @param includeNetworkCodes Whether a bare Node.js system error `code`
 * ({@link isTransientNetworkFailure}) counts as an AWS-shaped failure here.
 * `true` only for an AWS request site (`wrapAwsError`), where a refused,
 * reset or unreachable connection really did come from the SDK's own HTTP
 * layer. `false` for caller code (`wrapCallerError`) — an embeddings
 * provider's own client can raise the exact same codes over a connection
 * that has nothing to do with AWS, and reporting `awsErrorName`/`retryable`
 * for that would send a caller retrying the wrong thing. `$metadata`, a
 * declared `…Exception` name and the SDK's own `TimeoutError` are always
 * AWS-shaped regardless — an AWS-SDK-based model (Bedrock embeddings, say)
 * can legitimately throw one of those. The SDK's `TimeoutError` is a plain
 * Error; in caller code a `DOMException` of that name is the web platform's
 * (`AbortSignal.timeout()`, `fetch`) and is not AWS-shaped.
 *
 * Only an AWS-shaped cause contributes anything: one carrying the SDK's
 * `$metadata`, one whose name follows the service-exception convention
 * (`…Exception`), the SDK's own `TimeoutError`, or — only when
 * `includeNetworkCodes` is `true` — one whose `code` is a Node.js system
 * error the SDK's own retry strategy treats as transient. A plain `TypeError`
 * from caller code, or an `AbortError`, is not an AWS error and must not be
 * presented as one.
 */
function awsDiagnostics(cause: unknown, includeNetworkCodes: boolean): AwsDiagnostics {
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
  // `TimeoutError` carries no `$metadata` and is not named for a service
  // exception, but it is the SDK's own failure rather than a caller's bug — and
  // with a socket timeout now applied by default it is one callers will
  // actually see, so it has to arrive carrying a retryability verdict.
  // A refused, reset or unreachable connection carries neither `$metadata` nor
  // a recognised name either — it keeps whatever name Node gave it — but at an
  // AWS request site its `code` is one the SDK's own retry strategy treats as
  // transient, so it gets the same treatment there. `isTransientNetworkFailure`
  // is the one place that decides which errors qualify, so it — not a second
  // copy of its conditions — is what `includeNetworkCodes` gates.
  const isTransientNetwork = includeNetworkCodes && isTransientNetworkFailure(cause);
  // The name alone is the SDK's only at an AWS request site, where a request of
  // this package's is what timed out, whoever raised it. In caller code the same
  // name is also the web platform's: `AbortSignal.timeout()` and `fetch` reject
  // with a DOMException called `TimeoutError`, which is what an embeddings
  // client that has nothing to do with AWS throws when its own endpoint is
  // slow. The SDK's is a plain Error it renames, never a DOMException, so that
  // is the line. Another library's plain Error under this name cannot be told
  // from the SDK's by shape, and is still read as it.
  const isSdkTimeout =
    name === SDK_TIMEOUT_ERROR_NAME && (includeNetworkCodes || !isDomException(cause));
  const isSdkFailure =
    (name !== undefined && name.endsWith('Exception')) || isSdkTimeout || isTransientNetwork;
  if (metadata === undefined && !isSdkFailure) return {};

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
  out.retryable = isRetryable(candidate, name, out.httpStatusCode, isTransientNetwork);
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
 * The message a wrapped failure carries, built from its context alone.
 *
 * Accepts: the error's full context — `operation`, and `awsCommand` plus the
 * AWS diagnostics when it has them — and the cause.
 *
 * Returns: `"<operation> failed on <awsCommand> (<diagnostics>): <cause>"` —
 * without ` on <awsCommand>` when no request failed, and without the
 * parenthetical when there are no diagnostics — so a log line alone names the
 * method, the request and what AWS said.
 *
 * Throws: nothing. It runs inside error handling.
 *
 * Guarantees: this is the one place that format is stated, and both
 * {@link wrapAwsError} and {@link wrapCallerError} build their messages here.
 * It leads with the operation, which is what lets `attachOperation` report the
 * failure under another method's name without rebuilding the rest of it.
 */
function failureMessage(context: S3VectorsErrorContext, cause: unknown): string {
  const failed = context.awsCommand === undefined ? 'failed' : `failed on ${context.awsCommand}`;
  return `${context.operation} ${failed}${describeDiagnostics(context)}: ${toError(cause).message}`;
}

/**
 * Shared implementation behind {@link wrapAwsError} and {@link wrapCallerError}
 * — one builder, so the two differ only in `code` and in the request they
 * name, never in how a diagnostic is assembled.
 *
 * `awsCommand` is also what decides the network-code rule: a bare Node.js
 * system error `code` means the SDK's own HTTP layer failed only where a
 * request was issued, which is exactly where there is a command to name.
 */
function buildWrappedError(
  cause: unknown,
  code: S3VectorsErrorCode,
  context: Omit<S3VectorsErrorContext, 'awsCommand'>,
  awsCommand: AwsCommand | undefined,
): S3VectorsError {
  if (isS3VectorsError(cause)) return cause;
  const full: S3VectorsErrorContext = {
    ...context,
    ...(awsCommand === undefined ? {} : { awsCommand }),
    ...awsDiagnostics(cause, awsCommand !== undefined),
  };
  // `toError`, not the raw value: the class documents that `cause` is always
  // an Error when present, so a caller may read `error.cause.message` without
  // first checking what was actually thrown. A client rejecting with a string,
  // a number or null is legal JavaScript and made that false.
  return new S3VectorsError(failureMessage(full, cause), code, full, toError(cause));
}

/**
 * Wrap an unknown AWS failure into a coded {@link S3VectorsError}.
 *
 * Accepts: any thrown value; the code to assign it (chosen by
 * `classifyAwsError`); the S3 Vectors API operation whose request failed
 * (`"PutVectors"`); and the context to record, whose `operation` is the public
 * method the caller invoked. A required parameter rather than a context field,
 * so no request site can leave the command out. For an AWS request site
 * only — one where a bare Node.js system error `code`
 * ({@link isTransientNetworkFailure}) genuinely means the SDK's own HTTP
 * layer failed. Caller-supplied code (an embeddings model, a
 * `relevanceScoreFn`) must use {@link wrapCallerError} instead, which names no
 * request and never applies that rule.
 *
 * Returns: the value unchanged when it is already an {@link S3VectorsError},
 * so the layer nearest the failure keeps ownership of its message and class;
 * otherwise a new error carrying the original as `cause`, with `awsCommand`
 * set, and the AWS exception name, HTTP status, request id and retryability
 * lifted onto both the message and the context — so a log line alone is
 * enough to open an AWS Support case.
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
  awsCommand: AwsCommand,
  context: Omit<S3VectorsErrorContext, 'awsCommand'>,
): S3VectorsError {
  return buildWrappedError(cause, code, context, awsCommand);
}

/**
 * The error a failed AWS request becomes: classified, then wrapped.
 *
 * Accepts: whatever the SDK threw, the command that was issued, and the
 * context to name it under.
 *
 * Returns: an {@link S3VectorsError} carrying the code
 * {@link classifyAwsError} assigns and `awsCommand`.
 *
 * Throws: nothing.
 *
 * Guarantees: classification and wrapping happen together and in that order.
 * They were written out as a pair at four call sites, which is one decision
 * recorded four times — and a caller that classified differently, or forgot to,
 * would produce an error indistinguishable from the others except in its code.
 */
export function awsFailure(
  cause: unknown,
  awsCommand: AwsCommand,
  context: Omit<S3VectorsErrorContext, 'awsCommand'>,
): S3VectorsError {
  return wrapAwsError(cause, classifyAwsError(cause), awsCommand, context);
}

/**
 * Wrap a failure from caller-supplied code other than the embeddings model — a
 * `relevanceScoreFn`, a callback handler — into a coded {@link S3VectorsError}.
 * (The model has {@link wrapEmbeddingsError}, and a code of its own.) Always
 * `UNEXPECTED_ERROR`: every AWS request site in this package already wraps
 * its own failures with {@link wrapAwsError} before they can reach a
 * caller-code call site's own `catch`, so a value reaching this function came
 * from outside AWS.
 *
 * Accepts: any thrown value, and the context to record.
 *
 * Returns: the value unchanged when it is already an {@link S3VectorsError} —
 * an `EMBEDDINGS_MISSING` raised by a model lookup, say, passes through this
 * way; otherwise a new `UNEXPECTED_ERROR` carrying the original as `cause`,
 * with no `awsCommand`: no request of this package's failed.
 *
 * Unlike {@link wrapAwsError}, a bare Node.js system error `code`
 * ({@link isTransientNetworkFailure}) is never treated as an AWS diagnostic
 * here: caller code can raise the exact same codes — `ECONNREFUSED`,
 * `ENOTFOUND` — over a connection that has nothing to do with AWS, an
 * embeddings provider's own HTTP client refusing its own endpoint, say, and
 * reporting `awsErrorName`/`retryable` for that would send a caller retrying
 * against the wrong service. `$metadata`, a declared `…Exception` name and
 * the SDK's own `TimeoutError` are still recognised, because an
 * AWS-SDK-based model (Bedrock embeddings, say) can legitimately throw one of
 * those, and that diagnostic is genuinely about AWS either way.
 *
 * Throws: nothing.
 *
 * Guarantees: total.
 */
export function wrapCallerError(
  cause: unknown,
  context: Omit<S3VectorsErrorContext, 'awsCommand'>,
): S3VectorsError {
  return buildWrappedError(cause, S3VectorsErrorCode.UNEXPECTED_ERROR, context, undefined);
}

/**
 * Wrap a failure of the caller's embeddings model — `embedDocuments` or
 * `embedQuery` throwing — into a coded {@link S3VectorsError}.
 *
 * Accepts: any thrown value, and the context to record.
 *
 * Returns: the value unchanged when it is already an {@link S3VectorsError} —
 * the `EMBEDDINGS_MISSING` a model lookup raises passes through this way;
 * otherwise a new `EMBEDDINGS_FAILED` carrying the original as `cause`, with no
 * `awsCommand`: no request of this package's failed.
 *
 * Throws: nothing.
 *
 * Guarantees: total, and built exactly as {@link wrapCallerError} builds its
 * own — the model is caller-supplied code, so a bare Node.js system error
 * `code` is never read as an AWS diagnostic here either, while `$metadata`, a
 * declared `…Exception` name and the SDK's own `TimeoutError` still are. The
 * two differ in the code alone, which is the point: a provider outage is the
 * failure a caller retries, and sharing `UNEXPECTED_ERROR` with a bug in a
 * `relevanceScoreFn` meant a retry policy could not tell them apart.
 */
export function wrapEmbeddingsError(
  cause: unknown,
  context: Omit<S3VectorsErrorContext, 'awsCommand'>,
): S3VectorsError {
  return buildWrappedError(cause, S3VectorsErrorCode.EMBEDDINGS_FAILED, context, undefined);
}
