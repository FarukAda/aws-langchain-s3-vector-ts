[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:24](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L24)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### ABORTED

> **ABORTED**: `"ABORTED"`

Defined in: [shared/errors/error-code.ts:124](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L124)

The caller-supplied `AbortSignal` fired before or during the operation.

***

### ACCESS\_DENIED

> **ACCESS\_DENIED**: `"ACCESS_DENIED"`

Defined in: [shared/errors/error-code.ts:90](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L90)

`AccessDeniedException` (403), or any exception the service model does not
declare that arrives with HTTP 403 — which is how rejected credentials
arrive (`InvalidClientTokenId`, `MissingAuthenticationToken`).
`context.awsErrorName` keeps the name. An IAM or credentials problem, not a
retryable one.

***

### AWS\_INVALID\_RESPONSE

> **AWS\_INVALID\_RESPONSE**: `"AWS_INVALID_RESPONSE"`

Defined in: [shared/errors/error-code.ts:132](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L132)

An AWS response was missing, or carried an unusable value for, something
this library requires to proceed — a result's key, distance or embedding,
metadata that is not a copyable object, the index's metric — or was not an
object at all. Reachable only from a mocked, stubbed or otherwise
non-conforming client.

***

### AWS\_REJECTED

> **AWS\_REJECTED**: `"AWS_REJECTED"`

Defined in: [shared/errors/error-code.ts:105](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L105)

`ValidationException` (400). AWS rejected the request; `context.fieldList` names the field.

***

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:67](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L67)

An underlying AWS S3 Vectors request failed, and no narrower class applies.

***

### CONFLICT

> **CONFLICT**: `"CONFLICT"`

Defined in: [shared/errors/error-code.ts:101](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L101)

`ConflictException` (409): "a vector bucket name or a vector index name
already exists" (`@aws-sdk/client-s3vectors` `models/errors.d.ts`).

In practice always the index here, since this package never creates a
bucket — but the exception is the service's, not this package's, so the
wording is the service's too.

***

### EMBEDDINGS\_FAILED

> **EMBEDDINGS\_FAILED**: `"EMBEDDINGS_FAILED"`

Defined in: [shared/errors/error-code.ts:65](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L65)

The embeddings model threw: `embedDocuments` on a write, `embedQuery` on a
text search. The provider's own error is the `cause`.

A class of its own because it is the likeliest production failure this
package sees that is not AWS's — a provider rate-limiting or falling over —
and a caller's response to it is a retry policy of its own. It used to
share `UNEXPECTED_ERROR` with a bug in caller-supplied code and with input
that bypassed validation, so retrying the one meant retrying the others.

No request of this package's failed, so no `awsCommand` is set. An
AWS-SDK-based model (Bedrock embeddings, say) that throws its own service
exception still carries `awsErrorName` and `retryable`, about *that*
service. A model that returns something unusable, rather than throwing, is
`VALIDATION`.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:48](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L48)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:122](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L122)

An existing index disagrees with this store's configuration.

Two cases, both checked against what AWS actually reports rather than
assumed: the index's `distanceMetric`, read off the first `QueryVectors`
page of every search; and its non-filterable metadata keys, read off the
`GetIndex` that precedes a first write.

The vector *dimension* is not among them. AWS enforces it on every write,
and this package never had it to compare against — it is decided by the
first vector written, not by configuration. Vectors a write is given that
disagree with each other on dimension are a different thing, and raise this
code too — anywhere in an `addVectors` call, before any request; for
`addDocuments`, in any embedded batch whose dimension differs from the
first batch's, before that batch is written.

***

### KMS\_ERROR

> **KMS\_ERROR**: `"KMS_ERROR"`

Defined in: [shared/errors/error-code.ts:103](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L103)

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

Defined in: [shared/errors/error-code.ts:151](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L151)

A paginated read stopped with pages still outstanding. `context.awsCommand`
says which read: a `QueryVectors` search that reached this library's
1,000-page runaway ceiling before collecting `k` results, or either
paginator handed a token it had already followed — a page already read,
which repeated would return the same results again or never end. An
enumeration has no page ceiling, because a large index legitimately needs
many pages; only the repeated token stops it.

Distinct from a read that legitimately ran out — a search returns however
many it found and an enumeration simply ends, both without error. Removing
that ambiguity is what this code is for: a filtered query returning fewer
than `k` is normal and is not this, and neither is a listing reaching the
end of a small index.

A repeated token means a replayed or cached response rather than an
enormous index — an endpoint override, a proxy, or a non-conforming client.

***

### QUOTA\_EXCEEDED

> **QUOTA\_EXCEEDED**: `"QUOTA_EXCEEDED"`

Defined in: [shared/errors/error-code.ts:92](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L92)

`ServiceQuotaExceededException` (402). Needs a quota increase, not a retry.

***

### SERVICE\_UNAVAILABLE

> **SERVICE\_UNAVAILABLE**: `"SERVICE_UNAVAILABLE"`

Defined in: [shared/errors/error-code.ts:82](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L82)

`InternalServerException` (500), `ServiceUnavailableException` (503) or
`RequestTimeoutException` (408), or the SDK's own `TimeoutError` — a
connection, socket-idle or request timeout, or a connection reset or broken
on the way. Also a refused, unreachable or DNS-failed connection on an AWS
request, matched on the error's own `code` against the codes the SDK's
retry strategy lists as transient (the SDK also finds such a code in the
error's `cause`; this package does not). All transient, and already
retried by the SDK before reaching here. A 503 from
`PutVectors` is also AWS's documented response to a batch exceeding
resource capacity, which backoff cannot fix.

***

### THROTTLED

> **THROTTLED**: `"THROTTLED"`

Defined in: [shared/errors/error-code.ts:69](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L69)

`TooManyRequestsException` (429). Retry after backoff.

***

### UNEXPECTED\_ERROR

> **UNEXPECTED\_ERROR**: `"UNEXPECTED_ERROR"`

Defined in: [shared/errors/error-code.ts:163](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L163)

A failure that didn't come from an AWS request — a raw throw from
caller-supplied code other than the embeddings model (a `relevanceScoreFn`,
a callback handler; the model has `EMBEDDINGS_FAILED`) or caller input that
bypassed validation — above all a getter that throws when a document, a
filter, an options bag or the configuration is read, which is the
caller's code running inside the check. Every public method and both
constructors report it this way.
Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
AWS S3 Vectors request failing.

***

### VALIDATION

> **VALIDATION**: `"VALIDATION"`

Defined in: [shared/errors/error-code.ts:38](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/error-code.ts#L38)

Caller input was invalid — an argument, option, id, document, metadata,
vector, filter or configuration value this package can tell will not work —
or an embeddings model returned something other than one storable vector per
document, or an unusable query vector, or a `relevanceScoreFn` returned
something other than a finite number.

Raised before any AWS call and before any billable embedding, except for a
model's output — refused after that embedding call and before the request
it would feed, on a write carrying `writtenIds` because earlier batches may
already be written — and a `relevanceScoreFn` result, refused after the
search it scores.
