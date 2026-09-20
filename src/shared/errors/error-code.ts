/**
 * Hides how many kinds of failure a caller has to tell apart.
 *
 * Every failure in this package carries one of these, and the set is the
 * decision: a narrower code exists only where a caller would act differently
 * on it — retry, ask for a quota, fix an argument, call an operator. Failures
 * that call for the same response share a code rather than multiplying into
 * one per AWS exception name, so a `switch` here stays shorter than the
 * service's error list.
 *
 * The set only grows. A value is never removed, never renamed and never
 * reassigned to a different condition, so a code that was stored or logged
 * means the same thing for the life of a major. A new one may arrive in a
 * minor, and earns its place only by needing a caller response no existing
 * code already covers.
 *
 * What that costs a caller is worth stating exactly, because it is not
 * "nothing": a new member compiles fine in a `switch` with a `default` and in
 * an `if` on a single code, and breaks `Record<S3VectorsErrorCode, T>` and a
 * `never`-typed exhaustiveness assertion. Those two are the shapes to avoid
 * if you want a minor to stay a minor.
 */
/** Stable error codes surfaced by {@link S3VectorsError}. */
export enum S3VectorsErrorCode {
  /**
   * Caller input was invalid — an argument, option, id, document, metadata,
   * vector, filter or configuration value this package can tell will not work —
   * or an embeddings model returned something other than one storable vector per
   * document, or an unusable query vector, or a non-conforming client returned
   * metadata `structuredClone` cannot copy.
   *
   * Raised before any AWS call and before any billable embedding, except:
   * - a model's output, refused after that embedding call and before the
   *   request it would feed — on a write carrying `writtenIds`, because earlier
   *   batches may already be written;
   * - uncopyable response metadata, refused after that response.
   */
  VALIDATION = 'VALIDATION',
  /**
   * The bucket or index is not there (`NotFoundException`, 404).
   *
   * **Not** a missing vector id. `getByIds` reports that as `undefined` in the
   * id's slot, because `GetVectors` returns neither an entry nor an error for a
   * id that is not stored — absence is an ordinary answer, not a failure.
   */
  NOT_FOUND = 'NOT_FOUND',
  /** An operation needed an embedding model but none was configured. */
  EMBEDDINGS_MISSING = 'EMBEDDINGS_MISSING',
  /** An underlying AWS S3 Vectors request failed, and no narrower class applies. */
  AWS_REQUEST_FAILED = 'AWS_REQUEST_FAILED',
  /** `TooManyRequestsException` (429). Retry after backoff. */
  THROTTLED = 'THROTTLED',
  /**
   * `InternalServerException` (500), `ServiceUnavailableException` (503) or
   * `RequestTimeoutException` (408), or the SDK's own `TimeoutError` — a
   * connection, socket-idle or request timeout, or a connection reset or broken
   * on the way. Also a refused, unreachable or DNS-failed connection on an AWS
   * request, matched on the error's own `code` against the codes the SDK's
   * retry strategy lists as transient (the SDK also finds such a code in the
   * error's `cause`; this package does not). All transient, and already retried by the SDK before reaching here. A 503 from
   * `PutVectors` is also AWS's documented response to a batch exceeding
   * resource capacity, which backoff cannot fix.
   */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** `AccessDeniedException` (403). An IAM problem, not a retryable one. */
  ACCESS_DENIED = 'ACCESS_DENIED',
  /** `ServiceQuotaExceededException` (402). Needs a quota increase, not a retry. */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** `ConflictException` (409). The index name already exists. */
  CONFLICT = 'CONFLICT',
  /** One of the four KMS exceptions (400). Key state — an operator's problem. */
  KMS_ERROR = 'KMS_ERROR',
  /** `ValidationException` (400). AWS rejected the request; `context.fieldList` names the field. */
  AWS_REJECTED = 'AWS_REJECTED',
  /**
   * An existing index disagrees with this store's configuration.
   *
   * Two cases, both checked against what AWS actually reports rather than
   * assumed: the index's `distanceMetric`, read off the first `QueryVectors`
   * page of every search; and its non-filterable metadata keys, read off the
   * `GetIndex` that precedes a first write.
   *
   * The vector *dimension* is not among them. AWS enforces it on every write,
   * and this package never had it to compare against — it is decided by the
   * first vector written, not by configuration. Vectors a write is given that
   * disagree with each other on dimension are a different thing, and raise this
   * code too — anywhere in an `addVectors` call, before any request; within one
   * embedded batch for `addDocuments`, before that batch is written.
   */
  INDEX_CONFIG_MISMATCH = 'INDEX_CONFIG_MISMATCH',
  /** The caller-supplied `AbortSignal` fired before or during the operation. */
  ABORTED = 'ABORTED',
  /** An AWS response was missing fields this library requires to proceed. */
  AWS_INVALID_RESPONSE = 'AWS_INVALID_RESPONSE',
  /**
   * A paginated read stopped with pages still outstanding, because this
   * library's runaway page ceiling was reached. Both paginators raise it, and
   * `context.awsCommand` says which: a `QueryVectors` search that had not yet
   * collected `k` results, or a `ListVectors` enumeration still being asked for
   * more.
   *
   * Distinct from a read that legitimately ran out — a search returns however
   * many it found and an enumeration simply ends, both without error. Removing
   * that ambiguity is what this code is for: a filtered query returning fewer
   * than `k` is normal and is not this, and neither is a listing reaching the
   * end of a small index.
   *
   * On a listing it almost always means the token stopped advancing rather than
   * that the index is enormous — an endpoint override, a proxy, or a
   * non-conforming client replaying one response.
   */
  PAGE_LIMIT_EXCEEDED = 'PAGE_LIMIT_EXCEEDED',
  /**
   * A failure that didn't come from an AWS request — a raw throw from
   * caller-supplied code (e.g. an embeddings model) or caller input that
   * bypassed validation (e.g. a malformed argument to a static factory).
   * Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
   * AWS S3 Vectors request failing.
   */
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}
