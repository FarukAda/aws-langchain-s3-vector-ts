[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:2](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L2)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### ABORTED

> **ABORTED**: `"ABORTED"`

Defined in: [shared/errors/error-code.ts:53](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L53)

The caller-supplied `AbortSignal` fired before or during the operation.

***

### ACCESS\_DENIED

> **ACCESS\_DENIED**: `"ACCESS_DENIED"`

Defined in: [shared/errors/error-code.ts:29](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L29)

`AccessDeniedException` (403). An IAM problem, not a retryable one.

***

### AWS\_INVALID\_RESPONSE

> **AWS\_INVALID\_RESPONSE**: `"AWS_INVALID_RESPONSE"`

Defined in: [shared/errors/error-code.ts:55](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L55)

An AWS response was missing fields this library requires to proceed.

***

### AWS\_REJECTED

> **AWS\_REJECTED**: `"AWS_REJECTED"`

Defined in: [shared/errors/error-code.ts:37](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L37)

`ValidationException` (400). AWS rejected the request; `context.fieldList` names the field.

***

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:16](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L16)

An underlying AWS S3 Vectors request failed, and no narrower class applies.

***

### CONFLICT

> **CONFLICT**: `"CONFLICT"`

Defined in: [shared/errors/error-code.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L33)

`ConflictException` (409). The index name already exists.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:14](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L14)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:51](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L51)

An existing index disagrees with this store's configuration.

Two cases, both checked against what AWS actually reports rather than
assumed: the index's `distanceMetric`, read off the first `QueryVectors`
page of every search; and its non-filterable metadata keys, read off the
`GetIndex` that precedes a first write.

The vector *dimension* is not among them. AWS enforces it on every write,
and this package never had it to compare against — it is decided by the
first vector written, not by configuration. A batch whose own vectors
disagree on dimension is a different thing, and raises this code too.

***

### KMS\_ERROR

> **KMS\_ERROR**: `"KMS_ERROR"`

Defined in: [shared/errors/error-code.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L35)

One of the four KMS exceptions (400). Key state — an operator's problem.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [shared/errors/error-code.ts:12](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L12)

The bucket or index is not there (`NotFoundException`, 404).

**Not** a missing vector id. `getByIds` reports that as `undefined` in the
id's slot, because `GetVectors` returns neither an entry nor an error for a
key that is not stored — absence is an ordinary answer, not a failure.

***

### QUERY\_PAGE\_LIMIT\_EXCEEDED

> **QUERY\_PAGE\_LIMIT\_EXCEEDED**: `"QUERY_PAGE_LIMIT_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:66](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L66)

A paginated `QueryVectors` search stopped with pages still outstanding and
fewer than `k` results collected, because this library's runaway page
ceiling was reached.

Distinct from a search that legitimately ran out of matches, which returns
however many it found without error — that ambiguity is exactly what this
code exists to remove. A filtered query returning fewer than `k` is normal
and is not this.

***

### QUOTA\_EXCEEDED

> **QUOTA\_EXCEEDED**: `"QUOTA_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L31)

`ServiceQuotaExceededException` (402). Needs a quota increase, not a retry.

***

### SERVICE\_UNAVAILABLE

> **SERVICE\_UNAVAILABLE**: `"SERVICE_UNAVAILABLE"`

Defined in: [shared/errors/error-code.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L27)

`InternalServerException` (500), `ServiceUnavailableException` (503) or
`RequestTimeoutException` (408), or the SDK's own `TimeoutError` — a
connection, socket-idle or request timeout, or a connection refused, reset
or broken on the way. All transient, and already retried by the SDK before
reaching here. A 503 from `PutVectors` is also AWS's documented response to a
batch exceeding resource capacity, which backoff cannot fix.

***

### THROTTLED

> **THROTTLED**: `"THROTTLED"`

Defined in: [shared/errors/error-code.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L18)

`TooManyRequestsException` (429). Retry after backoff.

***

### UNEXPECTED\_ERROR

> **UNEXPECTED\_ERROR**: `"UNEXPECTED_ERROR"`

Defined in: [shared/errors/error-code.ts:74](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L74)

A failure that didn't come from an AWS request — a raw throw from
caller-supplied code (e.g. an embeddings model) or caller input that
bypassed validation (e.g. a malformed argument to a static factory).
Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
AWS S3 Vectors request failing.

***

### VALIDATION

> **VALIDATION**: `"VALIDATION"`

Defined in: [shared/errors/error-code.ts:4](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L4)

Caller-supplied arguments were invalid (counts, names, empty batch).
