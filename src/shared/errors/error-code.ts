/** Stable error codes surfaced by {@link S3VectorsError}. */
export enum S3VectorsErrorCode {
  /** Caller-supplied arguments were invalid (counts, names, empty batch). */
  VALIDATION = 'VALIDATION',
  /**
   * The bucket or index is not there (`NotFoundException`, 404).
   *
   * **Not** a missing vector id. `getByIds` reports that as `undefined` in the
   * id's slot, because `GetVectors` returns neither an entry nor an error for a
   * key that is not stored — absence is an ordinary answer, not a failure.
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
   * connection, socket-idle or request timeout, or a connection refused, reset
   * or broken on the way. All transient, and already retried by the SDK before
   * reaching here. A 503 from `PutVectors` is also AWS's documented response to a
   * batch exceeding resource capacity, which backoff cannot fix.
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
   * first vector written, not by configuration. A batch whose own vectors
   * disagree on dimension is a different thing, and raises this code too.
   */
  INDEX_CONFIG_MISMATCH = 'INDEX_CONFIG_MISMATCH',
  /** The caller-supplied `AbortSignal` fired before or during the operation. */
  ABORTED = 'ABORTED',
  /** An AWS response was missing fields this library requires to proceed. */
  AWS_INVALID_RESPONSE = 'AWS_INVALID_RESPONSE',
  /**
   * A paginated `QueryVectors` search stopped with pages still outstanding and
   * fewer than `k` results collected, because this library's runaway page
   * ceiling was reached.
   *
   * Distinct from a search that legitimately ran out of matches, which returns
   * however many it found without error — that ambiguity is exactly what this
   * code exists to remove. A filtered query returning fewer than `k` is normal
   * and is not this.
   */
  QUERY_PAGE_LIMIT_EXCEEDED = 'QUERY_PAGE_LIMIT_EXCEEDED',
  /**
   * A failure that didn't come from an AWS request — a raw throw from
   * caller-supplied code (e.g. an embeddings model) or caller input that
   * bypassed validation (e.g. a malformed argument to a static factory).
   * Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
   * AWS S3 Vectors request failing.
   */
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}
