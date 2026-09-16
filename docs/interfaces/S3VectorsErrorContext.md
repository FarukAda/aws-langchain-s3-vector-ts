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

Defined in: [shared/errors/s3-vectors-error.ts:88](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L88)

The AWS exception name (`"AccessDeniedException"`,
`"TooManyRequestsException"`, `"ValidationException"`, …) when the failure
came from an AWS SDK call. Lifted off `cause.name` so a log line or alert
can branch on it without walking `cause`.

Set on **every** error whose cause is AWS-shaped — one carrying the SDK's
`$metadata`, or named for a service exception — whatever code that error
was given. So `AWS_REJECTED` carries `"ValidationException"` and `THROTTLED`
carries `"TooManyRequestsException"`, not only the two codes this field was
once documented as being limited to. Absent when the failure did not come
from AWS: a validation error, or an embeddings model that threw.

***

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:66](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L66)

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

Defined in: [shared/errors/s3-vectors-error.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L33)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### fieldList?

> `readonly` `optional` **fieldList?**: `object`[]

Defined in: [shared/errors/s3-vectors-error.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L31)

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

Defined in: [shared/errors/s3-vectors-error.ts:122](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L122)

Ids confirmed found (and already fetched) before a partial fetch failure —
either a `GetVectors` batch rejecting while sibling batches in the same
concurrency group succeed, or an id genuinely not found after other ids in
the same group were already confirmed. Present so a caller doesn't have to
re-fetch everything from scratch.

Set by `getByIds` **and** by MMR, which fetches its candidates the same way.

***

### httpStatusCode?

> `readonly` `optional` **httpStatusCode?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:90](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L90)

HTTP status of the failed AWS response (`cause.$metadata.httpStatusCode`), when known.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:11](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L11)

The index the failed operation named. Absent only on a failure raised before one was known.

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:147](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L147)

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

Defined in: [shared/errors/s3-vectors-error.ts:47](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L47)

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

### requestId?

> `readonly` `optional` **requestId?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:95](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L95)

The AWS request id (`cause.$metadata.requestId`), when known. This is the
identifier AWS Support asks for — it also appears in the error message.

***

### resultsCollected?

> `readonly` `optional` **resultsCollected?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:53](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L53)

Results collected before a paginated search stopped early. Compare
against the requested `k` to see how far short it fell. Set alongside
[pagesScanned](#pagesscanned), on the same two cases.

***

### retryable?

> `readonly` `optional` **retryable?**: `boolean`

Defined in: [shared/errors/s3-vectors-error.ts:112](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L112)

Whether the failed AWS call is worth retrying after a backoff. `true` for
throttling (`TooManyRequestsException`, HTTP 429), transient service errors
(`ServiceUnavailableException`, `InternalServerException`,
`RequestTimeoutException`, HTTP 5xx), a `TimeoutError` from the SDK's own
HTTP handler, and anything the SDK itself marked `$retryable`.

Set alongside [awsErrorName](#awserrorname), on any AWS-shaped cause and whatever
code the error was given — `false` is a real answer and means "this will
fail again", which is the point. Absent when the failure did not come from
AWS at all.

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

Defined in: [shared/errors/s3-vectors-error.ts:74](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L74)

Vectors already yielded by an enumeration (`listDocuments`/`listVectors`)
before it failed. Those records have been consumed by the caller already,
so a listing is not atomic; this says how much of the index was covered,
alongside [pagesScanned](#pagesscanned).
