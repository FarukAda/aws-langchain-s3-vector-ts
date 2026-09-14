[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:2](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L2)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### ABORTED

> **ABORTED**: `"ABORTED"`

Defined in: [shared/errors/error-code.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L33)

The caller-supplied `AbortSignal` fired before or during the operation.

***

### ACCESS\_DENIED

> **ACCESS\_DENIED**: `"ACCESS_DENIED"`

Defined in: [shared/errors/error-code.ts:21](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L21)

`AccessDeniedException` (403). An IAM problem, not a retryable one.

***

### AWS\_INVALID\_RESPONSE

> **AWS\_INVALID\_RESPONSE**: `"AWS_INVALID_RESPONSE"`

Defined in: [shared/errors/error-code.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L35)

An AWS response was missing fields this library requires to proceed.

***

### AWS\_REJECTED

> **AWS\_REJECTED**: `"AWS_REJECTED"`

Defined in: [shared/errors/error-code.ts:29](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L29)

`ValidationException` (400). AWS rejected the request; `context.fieldList` names the field.

***

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:10](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L10)

An underlying AWS S3 Vectors request failed, and no narrower class applies.

***

### CONFLICT

> **CONFLICT**: `"CONFLICT"`

Defined in: [shared/errors/error-code.ts:25](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L25)

`ConflictException` (409). The index name already exists.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L8)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L31)

An existing index's dimension or distance metric doesn't match this store's configuration.

***

### KMS\_ERROR

> **KMS\_ERROR**: `"KMS_ERROR"`

Defined in: [shared/errors/error-code.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L27)

One of the four KMS exceptions (400). Key state — an operator's problem.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [shared/errors/error-code.ts:6](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L6)

A requested vector id or index was not found.

***

### QUERY\_PAGE\_LIMIT\_EXCEEDED

> **QUERY\_PAGE\_LIMIT\_EXCEEDED**: `"QUERY_PAGE_LIMIT_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:46](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L46)

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

Defined in: [shared/errors/error-code.ts:23](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L23)

`ServiceQuotaExceededException` (402). Needs a quota increase, not a retry.

***

### SERVICE\_UNAVAILABLE

> **SERVICE\_UNAVAILABLE**: `"SERVICE_UNAVAILABLE"`

Defined in: [shared/errors/error-code.ts:19](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L19)

`InternalServerException` (500), `ServiceUnavailableException` (503) or
`RequestTimeoutException` (408) — transient, and already retried by the
SDK before reaching here. A 503 from `PutVectors` is also AWS's documented
response to a batch exceeding resource capacity, which backoff cannot fix.

***

### THROTTLED

> **THROTTLED**: `"THROTTLED"`

Defined in: [shared/errors/error-code.ts:12](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L12)

`TooManyRequestsException` (429). Retry after backoff.

***

### UNEXPECTED\_ERROR

> **UNEXPECTED\_ERROR**: `"UNEXPECTED_ERROR"`

Defined in: [shared/errors/error-code.ts:54](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L54)

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
