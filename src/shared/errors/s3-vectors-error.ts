import type { AmazonS3Vectors } from '../../s3-vectors.js';
import { S3VectorsErrorCode } from './error-code.js';

/** Structured context attached to every {@link S3VectorsError}. */
export interface S3VectorsErrorContext {
  /** The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`). */
  readonly operation: string;
  /** The bucket the failed operation named. Absent only on a failure raised before one was known. */
  readonly vectorBucketName?: string;
  /** The index the failed operation named. Absent only on a failure raised before one was known. */
  readonly indexName?: string;
  /**
   * Ids confirmed durably written to AWS before a partial `addVectors`/
   * `addDocuments` failure — present so a caller (especially one relying
   * on auto-generated ids, which are otherwise lost entirely on failure)
   * can find and clean up or reconcile vectors that already landed.
   */
  readonly writtenIds?: string[];
  /**
   * Every id the failed write resolved, whether or not it landed. Retrying with
   * `{ ids: attemptedIds }` overwrites in place instead of minting fresh UUIDs
   * for the documents that already committed (DESIGN.md D-12).
   */
  readonly attemptedIds?: string[];
  /**
   * The specific validation failures AWS reported, each naming the field that
   * failed and why. A `ValidationException` carries these
   * (`@aws-sdk/client-s3vectors@3.1132.0` `dist-types/models/models_0.d.ts:94`)
   * and they are the actionable half of an otherwise opaque rejection.
   */
  readonly fieldList?: { path?: string; message?: string }[];
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
   * How many vectors the failed `PutVectors` call carried.
   *
   * Set only on a write failure, and present because AWS answers an oversized
   * batch with `ServiceUnavailableException` — the same 503 it uses for
   * genuine unavailability ("The number of vectors in a single request must
   * not exceed the resource capacity", `API_S3VectorBuckets_PutVectors.html`).
   * The two are indistinguishable by code, and the only prose that separates
   * them is AWS's own message, which is not a contract. Knowing the size of
   * the batch that failed is what lets a caller decide between backing off and
   * splitting.
   */
  readonly batchSize?: number;

  /**
   * Vectors already yielded by an enumeration (`listDocuments`/`listVectors`)
   * before it failed. Those records have been consumed by the caller already,
   * so a listing is not atomic; this says how much of the index was covered,
   * alongside {@link pagesScanned}.
   */
  readonly yielded?: number;
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
 * The single error type this library surfaces.
 *
 * Accepts: a message, a {@link S3VectorsErrorCode}, a context naming the
 * operation and the index, and optionally the underlying `cause`.
 *
 * Returns: an `Error` subclass whose `name` is always `'S3VectorsError'`, with
 * `code`, `context` and `cause` readonly once set — which is why every
 * decorator rebuilds rather than mutates.
 *
 * Throws: nothing.
 *
 * Guarantees: instances carry a `Symbol.for` brand, so {@link isS3VectorsError}
 * recognises them across realms and across the ESM and CommonJS copies of this
 * module. `cause` is always an `Error` when present: a caller can read
 * `error.cause.message` without checking what was actually thrown.
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

/**
 * Whether `value` is one of this library's errors.
 *
 * Accepts: anything, including a non-object.
 *
 * Returns: `true` when the value carries this package's registered-symbol
 * brand. Deliberately not `instanceof`: that is false across realms (a `vm`
 * context, a worker) and false between the ESM and CommonJS copies of this
 * module, which a process mixing `import` and `require` will load both of.
 *
 * Throws: nothing.
 *
 * Guarantees: this is the supported way to recognise these errors, and the
 * brand string is stable for `1.x` (`docs/STABILITY.md` §3).
 */
export function isS3VectorsError(value: unknown): value is S3VectorsError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, boolean>)[S3_VECTORS_ERROR_BRAND] === true
  );
}
