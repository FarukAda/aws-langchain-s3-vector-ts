/**
 * Hides that there is one error type.
 *
 * Every failure this package raises is this class, distinguished by a code rather
 * than by a subclass, so a caller writes one `catch` and switches on a value.
 * Recognising it across realms and across the ESM and CommonJS copies of this
 * package is a `Symbol.for` brand rather than `instanceof`, which is why
 * `isS3VectorsError` exists and why nothing here tests prototypes.
 */
import type { AmazonS3Vectors } from '../../s3-vectors.js';
import { S3VectorsErrorCode } from './error-code.js';

/** Structured context attached to every {@link S3VectorsError}. */
export interface S3VectorsErrorContext {
  /**
   * The public method the caller invoked — `"addDocuments"`, `"getByIds"`,
   * `"deleteIndex"`, `"fromDocuments"`, `"retriever.invoke"`, `"constructor"` —
   * on every error, whatever raised it: an argument check, a failed AWS request,
   * caller-supplied code, or another public method the invoked one runs
   * through. Never the name of an AWS command: the request that failed is
   * {@link awsCommand}.
   */
  readonly operation: string;
  /**
   * The S3 Vectors API operation whose request failed: `"GetIndex"`,
   * `"CreateIndex"`, `"DeleteIndex"`, `"PutVectors"`, `"DeleteVectors"`,
   * `"QueryVectors"`, `"GetVectors"` or `"ListVectors"`.
   *
   * Set on every error that wraps a failed AWS request, whatever code it was
   * given — `ABORTED` included, when the signal cancelled that request in
   * flight. Absent on every other error: a validation error; an abort that
   * cancelled no request, raised before any was issued or while waiting on an
   * index check another call started; a failure of caller-supplied code (an
   * embeddings model, a `relevanceScoreFn`), even one that throws an AWS-shaped
   * error of its own; and an `AWS_INVALID_RESPONSE` about a response that did
   * arrive.
   */
  readonly awsCommand?: string;
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
   * for the documents that already committed.
   */
  readonly attemptedIds?: string[];
  /**
   * Position, in the caller's own input and counted from 0 over the whole call
   * — never over a batch — of the one element this error is about.
   *
   * Set on every error raised for a single element of a caller's list: a
   * `VALIDATION` for a document, its metadata, a vector or an id, and the
   * `INDEX_CONFIG_MISMATCH` for a vector whose dimension disagrees with the
   * first. Raised by `addVectors`, `addDocuments`, `fromDocuments`, `fromTexts`,
   * `delete` and `getByIds`. Absent on every other error.
   */
  readonly recordIndex?: number;
  /**
   * The id of that element, whenever it has one that is a string: the resolved
   * id of a document or vector, or the offending id itself. Absent when the
   * element is not a string id, or when ids were not yet resolved (a document
   * that is not an object).
   */
  readonly recordId?: string;
  /**
   * The specific validation failures AWS reported, each naming the field that
   * failed and why. A `ValidationException` carries these
   * (`@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/models_0.d.ts:94`)
   * and they are the actionable half of an otherwise opaque rejection.
   */
  readonly fieldList?: { path?: string; message?: string }[];
  /** Ids confirmed durably deleted before a partial `delete({ ids })` failure. */
  readonly deletedIds?: string[];
  /**
   * Pages scanned before a paginated operation stopped.
   *
   * On a search: set on `PAGE_LIMIT_EXCEEDED`, and on a failure partway
   * through pagination (page 2 or later), where the code is whatever the
   * underlying call failed with.
   *
   * On a listing (`listDocuments`/`listVectors`): set on **every** failure,
   * including one on the very first page, where it reads `0`. That is the
   * useful answer rather than an omission — "nothing was scanned" is what a
   * caller needs to know — and it is why the record-level checks were moved
   * into the generator that keeps the count.
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
   * The name of an AWS-shaped cause (`"AccessDeniedException"`,
   * `"TooManyRequestsException"`, `"ValidationException"`, `"TimeoutError"`,
   * …). Lifted off `cause.name` so a log line or alert can branch on it
   * without walking `cause`.
   *
   * A cause is **AWS-shaped** when it carries the SDK's `$metadata`, when its
   * name follows the service-exception convention (`…Exception`), or when it is
   * the SDK's own `TimeoutError` — wherever it was thrown. So an AWS-SDK-based
   * embeddings model (Bedrock embeddings, say) that throws its own service
   * exception is AWS-shaped too, and its error carries this field, though never
   * an {@link awsCommand}: it is about that model's service, not a request of
   * this package's. On a failed AWS request only, a refused, reset or
   * unreachable connection is AWS-shaped as well: matched on the error's own
   * Node.js system error `code` against the codes the SDK's retry strategy
   * lists as transient — the SDK also finds such a code in the error's
   * `cause`; this package does not — and keeping whatever `name` Node gave it,
   * typically `"Error"`.
   *
   * Set on **every** error whose cause is AWS-shaped and has a name, whatever
   * code that error was given. So `AWS_REJECTED` carries
   * `"ValidationException"` and `THROTTLED` carries
   * `"TooManyRequestsException"`, not only the two codes this field was once
   * documented as being limited to. Absent on every other error: a validation
   * error, and caller-supplied code (an embeddings model, a `relevanceScoreFn`)
   * that threw something not AWS-shaped — a bare `ECONNREFUSED` of its own
   * included, which has nothing to do with AWS and must not be reported as if
   * it did.
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
   * Whether the failure is worth retrying after a backoff. `true` for
   * throttling (`TooManyRequestsException`, HTTP 429), transient service errors
   * (`ServiceUnavailableException`, `InternalServerException`,
   * `RequestTimeoutException`, HTTP 5xx), the SDK's own `TimeoutError`, a
   * refused, reset or unreachable connection **on an AWS request** (matched on
   * the error's own `code` against the codes the SDK's retry strategy lists,
   * as {@link awsErrorName} describes), and anything the SDK itself marked
   * `$retryable`.
   *
   * Set on every error whose cause is AWS-shaped, as {@link awsErrorName}
   * defines it, whatever code the error was given — `false` is a real answer
   * and means "this will fail again", which is the point. That includes
   * caller-supplied code: an AWS-SDK-based embeddings model whose own request
   * was throttled carries `retryable: true`, about that model's service, with
   * no {@link awsCommand}. Absent on every other error: a validation error, and
   * caller-supplied code (an embeddings model, a `relevanceScoreFn`) that threw
   * something not AWS-shaped — including a bare Node.js system error code of
   * its own, over a connection that has nothing to do with AWS. Reporting a
   * verdict for that would send a caller retrying against the wrong service.
   *
   * Note the SDK's own retry strategy (3 attempts by default) has usually
   * already run before an error reaches this library, so `retryable: true`
   * means those attempts were exhausted.
   */
  readonly retryable?: boolean;
  /**
   * Ids confirmed found (and already fetched) before a partial fetch failure —
   * either a `GetVectors` batch rejecting while sibling batches in the same
   * concurrency group succeed, or an id genuinely not found after other ids in
   * the same group were already confirmed. Present so a caller doesn't have to
   * re-fetch everything from scratch.
   *
   * Set by `getByIds` **and** by MMR, which fetches its candidates the same way.
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
 *
 * `code` and `context` are readonly at runtime, not only to TypeScript — defined
 * non-writable, with `context` frozen. Both were reassignable, and `context` was
 * stored as the caller's own object, so whoever built an error could still
 * rewrite what it reported afterwards. An error is a record of something that
 * already happened; it is not a place to keep mutable state.
 *
 * The frozen copy is made from property descriptors rather than by spreading,
 * because `context.instance` is deliberately non-enumerable and a spread would
 * drop it.
 */
export class S3VectorsError extends Error {
  readonly [S3_VECTORS_ERROR_BRAND] = true;
  declare readonly code: S3VectorsErrorCode;
  declare readonly context: S3VectorsErrorContext;

  constructor(
    message: string,
    code: S3VectorsErrorCode,
    context: S3VectorsErrorContext,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'S3VectorsError';

    // Descriptors, not a spread: `context.instance` is non-enumerable on purpose
    // so it stays out of logs, and spreading would drop it. `?? {}` guards only
    // against a nullish context, which would make `getOwnPropertyDescriptors`
    // throw from inside a constructor that is itself reporting a failure.
    const frozen = Object.freeze(
      Object.defineProperties({}, Object.getOwnPropertyDescriptors(context ?? {})),
    ) as S3VectorsErrorContext;

    // Enumerable, as class fields were, so `{ ...error }` and a structured
    // logger still see them — but not writable, which is what the contract above
    // has always said.
    Object.defineProperty(this, 'code', {
      value: code,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'context', {
      value: frozen,
      enumerable: true,
      writable: false,
      configurable: false,
    });
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
 * brand string is stable for `1.x`.
 */
export function isS3VectorsError(value: unknown): value is S3VectorsError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, boolean>)[S3_VECTORS_ERROR_BRAND] === true
  );
}
