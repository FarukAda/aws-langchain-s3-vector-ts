[**AWS LangChain S3 Vector TypeScript v0.6.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:5](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L5)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### deletedIds?

> `readonly` `optional` **deletedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L18)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### foundIds?

> `readonly` `optional` **foundIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:26](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L26)

Ids confirmed found (and already fetched) before a partial `getByIds`
failure — either a `GetVectors` batch rejecting while sibling batches
in the same concurrency group succeed, or an id genuinely not found
after other ids in the same group were already confirmed. Present so
a caller doesn't have to re-fetch everything from scratch.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:9](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L9)

***

### instance?

> `readonly` `optional` **instance?**: [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

Defined in: [shared/errors/s3-vectors-error.ts:45](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L45)

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
as something to log. (It happens to `JSON.stringify` safely — this
class inherits LangChain's `Serializable#toJSON()`, which renders it
as a small type-identifier stub rather than dumping internal state —
but that stub is rarely useful in a log line, so prefer logging the
other context fields individually instead.)

***

### operation

> `readonly` **operation**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:7](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L7)

The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`).

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L8)

***

### writtenIds?

> `readonly` `optional` **writtenIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:16](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L16)

Ids confirmed durably written to AWS before a partial `addVectors`/
`addDocuments` failure — present so a caller (especially one relying
on auto-generated ids, which are otherwise lost entirely on failure)
can find and clean up or reconcile vectors that already landed.
