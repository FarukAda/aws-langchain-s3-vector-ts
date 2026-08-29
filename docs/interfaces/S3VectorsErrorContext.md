[**AWS LangChain S3 Vector TypeScript v0.9.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:5](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L5)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### deletedIds?

> `readonly` `optional` **deletedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L18)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### foundIds?

> `readonly` `optional` **foundIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:41](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L41)

Ids confirmed found (and already fetched) before a partial `getByIds`
failure — either a `GetVectors` batch rejecting while sibling batches
in the same concurrency group succeed, or an id genuinely not found
after other ids in the same group were already confirmed. Present so
a caller doesn't have to re-fetch everything from scratch.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:9](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L9)

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:61](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L61)

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
as something to log. It does `JSON.stringify` safely: `AmazonS3Vectors`
pins `lc_serializable = false`, so LangChain's `Serializable#toJSON()`
short-circuits to a small type-identifier stub rather than dumping
internal state, and a regression test asserts no `_client` or
credentials appear in the output. That stub is rarely useful in a log
line, so prefer logging the other context fields individually.

***

### operation

> `readonly` **operation**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:7](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L7)

The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`).

***

### pagesScanned?

> `readonly` `optional` **pagesScanned?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L27)

`QueryVectors` pages scanned before a paginated search stopped early.

Set on a `QUERY_PAGE_LIMIT_EXCEEDED` error, and also on a failure that
happened partway through pagination (page 2 or later) — where the code
is whatever the underlying call failed with, typically
`AWS_REQUEST_FAILED`.

***

### resultsCollected?

> `readonly` `optional` **resultsCollected?**: `number`

Defined in: [shared/errors/s3-vectors-error.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L33)

Results collected before a paginated search stopped early. Compare
against the requested `k` to see how far short it fell. Set alongside
[pagesScanned](#pagesscanned), on the same two cases.

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L8)

***

### writtenIds?

> `readonly` `optional` **writtenIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:16](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4000a1f7254eb18b0b596902e146bd55873793f4/src/shared/errors/s3-vectors-error.ts#L16)

Ids confirmed durably written to AWS before a partial `addVectors`/
`addDocuments` failure — present so a caller (especially one relying
on auto-generated ids, which are otherwise lost entirely on failure)
can find and clean up or reconcile vectors that already landed.
