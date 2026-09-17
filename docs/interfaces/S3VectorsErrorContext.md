[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:5](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L5)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### attemptedIds?

> `readonly` `optional` **attemptedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:24](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L24)

Every id the failed write resolved, whether or not it landed. Retrying with
`{ ids: attemptedIds }` overwrites in place instead of minting fresh UUIDs
for the documents that already committed.

***

### awsErrorName?

> `readonly` `optional` **awsErrorName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:113](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L113)

The AWS exception name (`"AccessDeniedException"`,
`"TooManyRequestsException"`, `"ValidationException"`, …) when the failure
came from an AWS SDK call. Lifted off `cause.name` so a log line or alert
can branch on it without walking `cause`.

Set on **every** error whose cause is AWS-shaped — one carrying the SDK's
`$metadata`, named for a service exception, or — for a failed AWS
request only, never for a failure from caller-supplied code — a refused,
reset or unreachable connection, classified by its Node.js system error
`code` the same way the SDK's own retry strategy classifies it (it keeps
whatever `name` Node gave it, typically `"Error"`) — whatever code that
error was given. So `AWS_REJECTED` carries `"ValidationException"` and
`THROTTLED` carries `"TooManyRequestsException"`, not only the two codes
this field was once documented as being limited to. Absent when the
failure did not come from an AWS request: a validation error, or an
embeddings model or `relevanceScoreFn` that threw — even one that threw a
bare `ECONNREFUSED` of its own, which has nothing to do with AWS and must
not be reported as if it did.

***

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:84](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L84)

How many vectors the failed `PutVectors` call carried.

Set only on a write failure, and present because AWS answers an oversized
batch with `ServiceUnavailableException` — the same 503 it uses for
genuine unavailability ("The number of vectors in a single request must
not exceed the resource capacity", `API_S3VectorBuckets_PutVectors.html`).
The two are indistinguishable by code, and the only prose that separates
them is AWS's own message, which is not a contract. Knowing the size of
the batch that failed is what lets a caller decide between backing off and
splitting.

***

### deletedIds?

> `readonly` `optional` **deletedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:51](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L51)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### fieldList?

> `readonly` `optional` **fieldList?**: `object`[]

Defined in: [shared/errors/s3-vectors-error.ts:49](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L49)

The specific validation failures AWS reported, each naming the field that
failed and why. A `ValidationException` carries these
(`@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/models_0.d.ts:94`)
and they are the actionable half of an otherwise opaque rejection.

#### message?

> `optional` **message?**: `string`

#### path?

> `optional` **path?**: `string`

***

### foundIds?

> `readonly` `optional` **foundIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:153](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L153)

Ids confirmed found (and already fetched) before a partial fetch failure —
either a `GetVectors` batch rejecting while sibling batches in the same
concurrency group succeed, or an id genuinely not found after other ids in
the same group were already confirmed. Present so a caller doesn't have to
re-fetch everything from scratch.

Set by `getByIds` **and** by MMR, which fetches its candidates the same way.

***

### httpStatusCode?

> `readonly` `optional` **httpStatusCode?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:115](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L115)

HTTP status of the failed AWS response (`cause.$metadata.httpStatusCode`), when known.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:11](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L11)

The index the failed operation named. Absent only on a failure raised before one was known.

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:178](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L178)

The store constructed by a `fromDocuments`/`fromTexts` factory call that
failed partway through writing. Only ever set on an error thrown by
those two static factories — every other operation already runs
against a `this` the caller already holds a reference to. Lets a
caller act on `writtenIds` (`.delete({ ids: writtenIds })`,
`.getByIds(writtenIds)`) against the exact instance the ids were
written to, instead of reconstructing an equivalent one by hand.

Unlike every other field here, this is a live object handle, not
plain diagnostic data — treat it as a reference for programmatic
recovery (`error.context.instance.delete({ ids: writtenIds })`), not
as something to log. To keep it out of logs by accident it is defined
as a **non-enumerable** property: `JSON.stringify(error.context)`,
`util.inspect(error)`, `console.error(error)`, `{ ...error.context }`
and `Object.keys(error.context)` all omit it, while direct access
(`error.context.instance`) works as normal. Even when reached
explicitly it serializes safely: `AmazonS3Vectors` pins
`lc_serializable = false`, so LangChain's `Serializable#toJSON()`
short-circuits to a small type-identifier stub, and the store's
`lc_kwargs` never hold `credentials` or the `client`. Regression tests
assert no `_client` or credential material appears in any of those
renderings.

***

### operation

> `readonly` **operation**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:7](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L7)

The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`).

***

### pagesScanned?

> `readonly` `optional` **pagesScanned?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:65](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L65)

Pages scanned before a paginated operation stopped.

On a search: set on `QUERY_PAGE_LIMIT_EXCEEDED`, and on a failure partway
through pagination (page 2 or later), where the code is whatever the
underlying call failed with.

On a listing (`listDocuments`/`listVectors`): set on **every** failure,
including one on the very first page, where it reads `0`. That is the
useful answer rather than an omission — "nothing was scanned" is what a
caller needs to know — and it is why the record-level checks were moved
into the generator that keeps the count.

***

### recordId?

> `readonly` `optional` **recordId?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:42](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L42)

The id of that element, whenever it has one that is a string: the resolved
id of a document or vector, or the offending id itself. Absent when the
element is not a string id, or when ids were not yet resolved (a document
that is not an object).

***

### recordIndex?

> `readonly` `optional` **recordIndex?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L35)

Position, in the caller's own input and counted from 0 over the whole call
— never over a batch — of the one element this error is about.

Set on every error raised for a single element of a caller's list: a
`VALIDATION` for a document, its metadata, a vector or an id, and the
`INDEX_CONFIG_MISMATCH` for a vector whose dimension disagrees with the
first. Raised by `addVectors`, `addDocuments`, `fromDocuments`, `fromTexts`,
`delete` and `getByIds`. Absent on every other error.

***

### requestId?

> `readonly` `optional` **requestId?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:120](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L120)

The AWS request id (`cause.$metadata.requestId`), when known. This is the
identifier AWS Support asks for — it also appears in the error message.

***

### resultsCollected?

> `readonly` `optional` **resultsCollected?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:71](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L71)

Results collected before a paginated search stopped early. Compare
against the requested `k` to see how far short it fell. Set alongside
[pagesScanned](#pagesscanned), on the same two cases.

***

### retryable?

> `readonly` `optional` **retryable?**: `boolean`

Defined in: [shared/errors/s3-vectors-error.ts:143](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L143)

Whether the failed AWS call is worth retrying after a backoff. `true` for
throttling (`TooManyRequestsException`, HTTP 429), transient service errors
(`ServiceUnavailableException`, `InternalServerException`,
`RequestTimeoutException`, HTTP 5xx), a `TimeoutError` from the SDK's own
HTTP handler, a refused, reset or unreachable connection **on an AWS
request** (classified by `code` the same way the SDK's own retry
strategy classifies it), and anything the SDK itself marked `$retryable`.

Set alongside [awsErrorName](#awserrorname), on any AWS-shaped cause and whatever
code the error was given — `false` is a real answer and means "this will
fail again", which is the point. Absent when the failure did not come from
an AWS request at all: a validation error, or caller-supplied code (an
embeddings model, a `relevanceScoreFn`) that threw — including one that
threw a bare Node.js system error code of its own, over a connection that
has nothing to do with AWS. Reporting a verdict for that would send a
caller retrying against the wrong service.

Note the SDK's own retry strategy (3 attempts by default) has usually
already run before an error reaches this library, so `retryable: true`
means those attempts were exhausted.

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:9](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L9)

The bucket the failed operation named. Absent only on a failure raised before one was known.

***

### writtenIds?

> `readonly` `optional` **writtenIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L18)

Ids confirmed durably written to AWS before a partial `addVectors`/
`addDocuments` failure — present so a caller (especially one relying
on auto-generated ids, which are otherwise lost entirely on failure)
can find and clean up or reconcile vectors that already landed.

***

### yielded?

> `readonly` `optional` **yielded?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:92](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L92)

Vectors already yielded by an enumeration (`listDocuments`/`listVectors`)
before it failed. Those records have been consumed by the caller already,
so a listing is not atomic; this says how much of the index was covered,
alongside [pagesScanned](#pagesscanned).
