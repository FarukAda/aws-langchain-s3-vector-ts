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
for the documents that already committed (DESIGN.md D-12).

***

### awsErrorName?

> `readonly` `optional` **awsErrorName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:77](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L77)

The AWS exception name (`"AccessDeniedException"`, `"ThrottlingException"`,
`"ValidationException"`, …) when the failure came from an AWS SDK call.
Lifted off `cause.name` so a log line or alert can branch on it without
walking `cause`. Set on `AWS_REQUEST_FAILED` and `NOT_FOUND`
errors whose cause is an SDK error; absent otherwise.

***

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:61](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L61)

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
(`@aws-sdk/client-s3vectors@3.1132.0` `dist-types/models/models_0.d.ts:94`)
and they are the actionable half of an otherwise opaque rejection.

#### message?

> `optional` **message?**: `string`

#### path?

> `optional` **path?**: `string`

***

### foundIds?

> `readonly` `optional` **foundIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:104](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L104)

Ids confirmed found (and already fetched) before a partial `getByIds`
failure — either a `GetVectors` batch rejecting while sibling batches
in the same concurrency group succeed, or an id genuinely not found
after other ids in the same group were already confirmed. Present so
a caller doesn't have to re-fetch everything from scratch.

***

### httpStatusCode?

> `readonly` `optional` **httpStatusCode?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:79](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L79)

HTTP status of the failed AWS response (`cause.$metadata.httpStatusCode`), when known.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:11](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L11)

The index the failed operation named. Absent only on a failure raised before one was known.

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:129](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L129)

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

Defined in: [shared/errors/s3-vectors-error.ts:42](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L42)

`QueryVectors` pages scanned before a paginated search stopped early.

Set on a `QUERY_PAGE_LIMIT_EXCEEDED` error, and also on a failure that
happened partway through pagination (page 2 or later) — where the code
is whatever the underlying call failed with, typically
`AWS_REQUEST_FAILED`.

***

### requestId?

> `readonly` `optional` **requestId?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:84](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L84)

The AWS request id (`cause.$metadata.requestId`), when known. This is the
identifier AWS Support asks for — it also appears in the error message.

***

### resultsCollected?

> `readonly` `optional` **resultsCollected?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:48](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L48)

Results collected before a paginated search stopped early. Compare
against the requested `k` to see how far short it fell. Set alongside
[pagesScanned](#pagesscanned), on the same two cases.

***

### retryable?

> `readonly` `optional` **retryable?**: `boolean`

Defined in: [shared/errors/s3-vectors-error.ts:96](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L96)

Whether the failed AWS call is worth retrying after a backoff. `true` for
throttling (`ThrottlingException`, `TooManyRequestsException`, HTTP 429),
transient service errors (`ServiceUnavailableException`,
`InternalServerException`, HTTP 5xx) and anything the SDK itself marked
`$retryable`. Only set when the cause is an AWS SDK error; a non-AWS
failure (an embeddings model throwing, a validation error) leaves it
`undefined`. Note the SDK's own retry strategy (3 attempts by default)
has usually already run before an error reaches this library — a
`retryable: true` error means those attempts were exhausted.

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

Defined in: [shared/errors/s3-vectors-error.ts:69](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L69)

Vectors already yielded by an enumeration (`listDocuments`/`listVectors`)
before it failed. Those records have been consumed by the caller already,
so a listing is not atomic; this says how much of the index was covered,
alongside [pagesScanned](#pagesscanned).
