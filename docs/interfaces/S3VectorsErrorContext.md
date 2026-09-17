[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:5](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L5)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### attemptedIds?

> `readonly` `optional` **attemptedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:46](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L46)

Every id the failed write resolved, whether or not it landed. Retrying with
`{ ids: attemptedIds }` overwrites in place instead of minting fresh UUIDs
for the documents that already committed.

***

### awsCommand?

> `readonly` `optional` **awsCommand?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:29](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L29)

The S3 Vectors API operation whose request failed: `"GetIndex"`,
`"CreateIndex"`, `"DeleteIndex"`, `"PutVectors"`, `"DeleteVectors"`,
`"QueryVectors"`, `"GetVectors"` or `"ListVectors"`.

Set on every error that wraps a failed AWS request, whatever code it was
given — `ABORTED` included, when the signal cancelled that request in
flight. Absent on every other error: a validation error; an abort that
cancelled no request, raised before any was issued or while waiting on an
index check another call started; a failure of caller-supplied code (an
embeddings model, a `relevanceScoreFn`), even one that throws an AWS-shaped
error of its own; and an `AWS_INVALID_RESPONSE` about a response that did
arrive.

***

### awsErrorName?

> `readonly` `optional` **awsErrorName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:144](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L144)

The name of an AWS-shaped cause (`"AccessDeniedException"`,
`"TooManyRequestsException"`, `"ValidationException"`, `"TimeoutError"`,
…). Lifted off `cause.name` so a log line or alert can branch on it
without walking `cause`.

A cause is **AWS-shaped** when it carries the SDK's `$metadata`, when its
name follows the service-exception convention (`…Exception`), or when it is
the SDK's own `TimeoutError` — wherever it was thrown. So an AWS-SDK-based
embeddings model (Bedrock embeddings, say) that throws its own service
exception is AWS-shaped too, and its error carries this field, though never
an [awsCommand](#awscommand): it is about that model's service, not a request of
this package's. On a failed AWS request only, a refused, reset or
unreachable connection is AWS-shaped as well: matched on the error's own
Node.js system error `code` against the codes the SDK's retry strategy
lists as transient — the SDK also finds such a code in the error's
`cause`; this package does not — and keeping whatever `name` Node gave it,
typically `"Error"`.

Set on **every** error whose cause is AWS-shaped and has a name, whatever
code that error was given. So `AWS_REJECTED` carries
`"ValidationException"` and `THROTTLED` carries
`"TooManyRequestsException"`, not only the two codes this field was once
documented as being limited to. Absent on every other error: a validation
error, and caller-supplied code (an embeddings model, a `relevanceScoreFn`)
that threw something not AWS-shaped — a bare `ECONNREFUSED` of its own
included, which has nothing to do with AWS and must not be reported as if
it did.

***

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:106](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L106)

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

Defined in: [shared/errors/s3-vectors-error.ts:73](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L73)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### fieldList?

> `readonly` `optional` **fieldList?**: `object`[]

Defined in: [shared/errors/s3-vectors-error.ts:71](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L71)

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

Defined in: [shared/errors/s3-vectors-error.ts:187](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L187)

Ids confirmed found (and already fetched) before a partial fetch failure —
either a `GetVectors` batch rejecting while sibling batches in the same
concurrency group succeed, or an id genuinely not found after other ids in
the same group were already confirmed. Present so a caller doesn't have to
re-fetch everything from scratch.

Set by `getByIds` **and** by MMR, which fetches its candidates the same way.

***

### httpStatusCode?

> `readonly` `optional` **httpStatusCode?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:146](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L146)

HTTP status of the failed AWS response (`cause.$metadata.httpStatusCode`), when known.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L33)

The index the failed operation named. Absent only on a failure raised before one was known.

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:212](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L212)

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

Defined in: [shared/errors/s3-vectors-error.ts:14](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L14)

The public method the caller invoked — `"addDocuments"`, `"getByIds"`,
`"deleteIndex"`, `"fromDocuments"`, `"retriever.invoke"`, `"constructor"` —
on every error, whatever raised it: an argument check, a failed AWS request,
caller-supplied code, or another public method the invoked one runs
through. Never the name of an AWS command: the request that failed is
[awsCommand](#awscommand).

***

### pagesScanned?

> `readonly` `optional` **pagesScanned?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:87](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L87)

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

Defined in: [shared/errors/s3-vectors-error.ts:64](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L64)

The id of that element, whenever it has one that is a string: the resolved
id of a document or vector, or the offending id itself. Absent when the
element is not a string id, or when ids were not yet resolved (a document
that is not an object).

***

### recordIndex?

> `readonly` `optional` **recordIndex?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:57](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L57)

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

Defined in: [shared/errors/s3-vectors-error.ts:151](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L151)

The AWS request id (`cause.$metadata.requestId`), when known. This is the
identifier AWS Support asks for — it also appears in the error message.

***

### resultsCollected?

> `readonly` `optional` **resultsCollected?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:93](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L93)

Results collected before a paginated search stopped early. Compare
against the requested `k` to see how far short it fell. Set alongside
[pagesScanned](#pagesscanned), on the same two cases.

***

### retryable?

> `readonly` `optional` **retryable?**: `boolean`

Defined in: [shared/errors/s3-vectors-error.ts:177](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L177)

Whether the failure is worth retrying after a backoff. `true` for
throttling (`TooManyRequestsException`, HTTP 429), transient service errors
(`ServiceUnavailableException`, `InternalServerException`,
`RequestTimeoutException`, HTTP 5xx), the SDK's own `TimeoutError`, a
refused, reset or unreachable connection **on an AWS request** (matched on
the error's own `code` against the codes the SDK's retry strategy lists,
as [awsErrorName](#awserrorname) describes), and anything the SDK itself marked
`$retryable`.

Set on every error whose cause is AWS-shaped, as [awsErrorName](#awserrorname)
defines it, whatever code the error was given — `false` is a real answer
and means "this will fail again", which is the point. That includes
caller-supplied code: an AWS-SDK-based embeddings model whose own request
was throttled carries `retryable: true`, about that model's service, with
no [awsCommand](#awscommand). Absent on every other error: a validation error, and
caller-supplied code (an embeddings model, a `relevanceScoreFn`) that threw
something not AWS-shaped — including a bare Node.js system error code of
its own, over a connection that has nothing to do with AWS. Reporting a
verdict for that would send a caller retrying against the wrong service.

Note the SDK's own retry strategy (3 attempts by default) has usually
already run before an error reaches this library, so `retryable: true`
means those attempts were exhausted.

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L31)

The bucket the failed operation named. Absent only on a failure raised before one was known.

***

### writtenIds?

> `readonly` `optional` **writtenIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:40](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L40)

Ids confirmed durably written to AWS before a partial `addVectors`/
`addDocuments` failure — present so a caller (especially one relying
on auto-generated ids, which are otherwise lost entirely on failure)
can find and clean up or reconcile vectors that already landed.

***

### yielded?

> `readonly` `optional` **yielded?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:114](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L114)

Vectors already yielded by an enumeration (`listDocuments`/`listVectors`)
before it failed. Those records have been consumed by the caller already,
so a listing is not atomic; this says how much of the index was covered,
alongside [pagesScanned](#pagesscanned).
