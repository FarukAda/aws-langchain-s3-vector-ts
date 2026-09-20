[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:24](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L24)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### ABORTED

> **ABORTED**: `"ABORTED"`

Defined in: [shared/errors/error-code.ts:92](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L92)

The caller-supplied `AbortSignal` fired before or during the operation.

***

### ACCESS\_DENIED

> **ACCESS\_DENIED**: `"ACCESS_DENIED"`

Defined in: [shared/errors/error-code.ts:66](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L66)

`AccessDeniedException` (403). An IAM problem, not a retryable one.

***

### AWS\_INVALID\_RESPONSE

> **AWS\_INVALID\_RESPONSE**: `"AWS_INVALID_RESPONSE"`

Defined in: [shared/errors/error-code.ts:94](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L94)

An AWS response was missing fields this library requires to proceed.

***

### AWS\_REJECTED

> **AWS\_REJECTED**: `"AWS_REJECTED"`

Defined in: [shared/errors/error-code.ts:74](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L74)

`ValidationException` (400). AWS rejected the request; `context.fieldList` names the field.

***

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:50](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L50)

An underlying AWS S3 Vectors request failed, and no narrower class applies.

***

### CONFLICT

> **CONFLICT**: `"CONFLICT"`

Defined in: [shared/errors/error-code.ts:70](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L70)

`ConflictException` (409). The index name already exists.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:48](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L48)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:90](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L90)

An existing index disagrees with this store's configuration.

Two cases, both checked against what AWS actually reports rather than
assumed: the index's `distanceMetric`, read off the first `QueryVectors`
page of every search; and its non-filterable metadata keys, read off the
`GetIndex` that precedes a first write.

The vector *dimension* is not among them. AWS enforces it on every write,
and this package never had it to compare against — it is decided by the
first vector written, not by configuration. Vectors a write is given that
disagree with each other on dimension are a different thing, and raise this
code too — anywhere in an `addVectors` call, before any request; within one
embedded batch for `addDocuments`, before that batch is written.

***

### KMS\_ERROR

> **KMS\_ERROR**: `"KMS_ERROR"`

Defined in: [shared/errors/error-code.ts:72](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L72)

One of the four KMS exceptions (400). Key state — an operator's problem.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [shared/errors/error-code.ts:46](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L46)

The bucket or index is not there (`NotFoundException`, 404).

**Not** a missing vector id. `getByIds` reports that as `undefined` in the
id's slot, because `GetVectors` returns neither an entry nor an error for a
id that is not stored — absence is an ordinary answer, not a failure.

***

### PAGE\_LIMIT\_EXCEEDED

> **PAGE\_LIMIT\_EXCEEDED**: `"PAGE_LIMIT_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:112](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L112)

A paginated read stopped with pages still outstanding, because this
library's runaway page ceiling was reached. Both paginators raise it, and
`context.awsCommand` says which: a `QueryVectors` search that had not yet
collected `k` results, or a `ListVectors` enumeration still being asked for
more.

Distinct from a read that legitimately ran out — a search returns however
many it found and an enumeration simply ends, both without error. Removing
that ambiguity is what this code is for: a filtered query returning fewer
than `k` is normal and is not this, and neither is a listing reaching the
end of a small index.

On a listing it almost always means the token stopped advancing rather than
that the index is enormous — an endpoint override, a proxy, or a
non-conforming client replaying one response.

***

### QUOTA\_EXCEEDED

> **QUOTA\_EXCEEDED**: `"QUOTA_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:68](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L68)

`ServiceQuotaExceededException` (402). Needs a quota increase, not a retry.

***

### SERVICE\_UNAVAILABLE

> **SERVICE\_UNAVAILABLE**: `"SERVICE_UNAVAILABLE"`

Defined in: [shared/errors/error-code.ts:64](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L64)

`InternalServerException` (500), `ServiceUnavailableException` (503) or
`RequestTimeoutException` (408), or the SDK's own `TimeoutError` — a
connection, socket-idle or request timeout, or a connection reset or broken
on the way. Also a refused, unreachable or DNS-failed connection on an AWS
request, matched on the error's own `code` against the codes the SDK's
retry strategy lists as transient (the SDK also finds such a code in the
error's `cause`; this package does not). All transient, and already retried by the SDK before reaching here. A 503 from
`PutVectors` is also AWS's documented response to a batch exceeding
resource capacity, which backoff cannot fix.

***

### THROTTLED

> **THROTTLED**: `"THROTTLED"`

Defined in: [shared/errors/error-code.ts:52](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L52)

`TooManyRequestsException` (429). Retry after backoff.

***

### UNEXPECTED\_ERROR

> **UNEXPECTED\_ERROR**: `"UNEXPECTED_ERROR"`

Defined in: [shared/errors/error-code.ts:120](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L120)

A failure that didn't come from an AWS request — a raw throw from
caller-supplied code (e.g. an embeddings model) or caller input that
bypassed validation (e.g. a malformed argument to a static factory).
Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
AWS S3 Vectors request failing.

***

### VALIDATION

> **VALIDATION**: `"VALIDATION"`

Defined in: [shared/errors/error-code.ts:38](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L38)

Caller input was invalid — an argument, option, id, document, metadata,
vector, filter or configuration value this package can tell will not work —
or an embeddings model returned something other than one storable vector per
document, or an unusable query vector, or a non-conforming client returned
metadata `structuredClone` cannot copy.

Raised before any AWS call and before any billable embedding, except:
- a model's output, refused after that embedding call and before the
  request it would feed — on a write carrying `writtenIds`, because earlier
  batches may already be written;
- uncopyable response metadata, refused after that response.
