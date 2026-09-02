import type { AmazonS3Vectors } from '../../s3-vectors.js';
import { S3VectorsErrorCode } from './error-code.js';

/** Structured context attached to every {@link S3VectorsError}. */
export interface S3VectorsErrorContext {
  /** The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`). */
  readonly operation: string;
  readonly vectorBucketName?: string;
  readonly indexName?: string;
  /**
   * Ids confirmed durably written to AWS before a partial `addVectors`/
   * `addDocuments` failure — present so a caller (especially one relying
   * on auto-generated ids, which are otherwise lost entirely on failure)
   * can find and clean up or reconcile vectors that already landed.
   */
  readonly writtenIds?: string[];
  /** Ids confirmed durably deleted before a partial `delete({ ids })` failure. */
  readonly deletedIds?: string[];
  /**
   * `QueryVectors` pages scanned before a paginated search stopped early.
   *
   * Set on a `QUERY_PAGE_LIMIT_EXCEEDED` error, and also on a failure that
   * happened partway through pagination (page 2 or later) — where the code
   * is whatever the underlying call failed with, typically
   * `AWS_REQUEST_FAILED`.
   */
  readonly pagesScanned?: number;
  /**
   * Results collected before a paginated search stopped early. Compare
   * against the requested `k` to see how far short it fell. Set alongside
   * {@link pagesScanned}, on the same two cases.
   */
  readonly resultsCollected?: number;
  /**
   * The AWS exception name (`"AccessDeniedException"`, `"ThrottlingException"`,
   * `"ValidationException"`, …) when the failure came from an AWS SDK call.
   * Lifted off `cause.name` so a log line or alert can branch on it without
   * walking `cause`. Set on `AWS_REQUEST_FAILED` and `NOT_FOUND`
   * errors whose cause is an SDK error; absent otherwise.
   */
  readonly awsErrorName?: string;
  /** HTTP status of the failed AWS response (`cause.$metadata.httpStatusCode`), when known. */
  readonly httpStatusCode?: number;
  /**
   * The AWS request id (`cause.$metadata.requestId`), when known. This is the
   * identifier AWS Support asks for — it also appears in the error message.
   */
  readonly requestId?: string;
  /**
   * Whether the failed AWS call is worth retrying after a backoff. `true` for
   * throttling (`ThrottlingException`, `TooManyRequestsException`, HTTP 429),
   * transient service errors (`ServiceUnavailableException`,
   * `InternalServerException`, HTTP 5xx) and anything the SDK itself marked
   * `$retryable`. Only set when the cause is an AWS SDK error; a non-AWS
   * failure (an embeddings model throwing, a validation error) leaves it
   * `undefined`. Note the SDK's own retry strategy (3 attempts by default)
   * has usually already run before an error reaches this library — a
   * `retryable: true` error means those attempts were exhausted.
   */
  readonly retryable?: boolean;
  /**
   * `true` when a `PutVectors` failure (`NotFoundException` or
   * `ValidationException`) made the store discard its cached index
   * dimension/distance metric. The next write on this instance re-checks
   * the index with `GetIndex` — and, with `createIndexIfNotExist`,
   * re-creates a missing one — instead of trusting a cache that may
   * describe an index deleted or re-created outside this process. A
   * caller that retries writes can treat this as "retrying is worth it".
   */
  readonly indexCacheInvalidated?: true;
  /**
   * Ids confirmed found (and already fetched) before a partial `getByIds`
   * failure — either a `GetVectors` batch rejecting while sibling batches
   * in the same concurrency group succeed, or an id genuinely not found
   * after other ids in the same group were already confirmed. Present so
   * a caller doesn't have to re-fetch everything from scratch.
   */
  readonly foundIds?: string[];
  /**
   * The store constructed by a `fromDocuments`/`fromTexts` factory call that
   * failed partway through writing. Only ever set on an error thrown by
   * those two static factories — every other operation already runs
   * against a `this` the caller already holds a reference to. Lets a
   * caller act on `writtenIds` (`.delete({ ids: writtenIds })`,
   * `.getByIds(writtenIds)`) against the exact instance the ids were
   * written to, instead of reconstructing an equivalent one by hand.
   *
   * Unlike every other field here, this is a live object handle, not
   * plain diagnostic data — treat it as a reference for programmatic
   * recovery (`error.context.instance.delete({ ids: writtenIds })`), not
   * as something to log. To keep it out of logs by accident it is defined
   * as a **non-enumerable** property: `JSON.stringify(error.context)`,
   * `util.inspect(error)`, `console.error(error)`, `{ ...error.context }`
   * and `Object.keys(error.context)` all omit it, while direct access
   * (`error.context.instance`) works as normal. Even when reached
   * explicitly it serializes safely: `AmazonS3Vectors` pins
   * `lc_serializable = false`, so LangChain's `Serializable#toJSON()`
   * short-circuits to a small type-identifier stub, and the store's
   * `lc_kwargs` never hold `credentials` or the `client`. Regression tests
   * assert no `_client` or credential material appears in any of those
   * renderings.
   */
  readonly instance?: AmazonS3Vectors;
}

const S3_VECTORS_ERROR_BRAND = Symbol.for('@farukada/aws-langchain-s3-vector-ts:S3VectorsError');

/**
 * The single error type surfaced by this library. Wraps validation failures,
 * not-found conditions, and underlying AWS errors behind one consistent shape.
 */
export class S3VectorsError extends Error {
  readonly [S3_VECTORS_ERROR_BRAND] = true;
  readonly code: S3VectorsErrorCode;
  readonly context: S3VectorsErrorContext;

  constructor(
    message: string,
    code: S3VectorsErrorCode,
    context: S3VectorsErrorContext,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'S3VectorsError';
    this.code = code;
    this.context = context;
  }
}

/** Type guard for {@link S3VectorsError} that avoids `instanceof`. */
export function isS3VectorsError(value: unknown): value is S3VectorsError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, boolean>)[S3_VECTORS_ERROR_BRAND] === true
  );
}
