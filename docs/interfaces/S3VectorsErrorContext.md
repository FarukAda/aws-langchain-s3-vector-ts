[**AWS LangChain S3 Vector TypeScript v0.4.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:4](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L4)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### deletedIds?

> `readonly` `optional` **deletedIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:17](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L17)

Ids confirmed durably deleted before a partial `delete({ ids })` failure.

***

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L8)

***

### operation

> `readonly` **operation**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:6](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L6)

The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`).

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:7](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L7)

***

### writtenIds?

> `readonly` `optional` **writtenIds?**: `string`[]

Defined in: [shared/errors/s3-vectors-error.ts:15](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L15)

Ids confirmed durably written to AWS before a partial `addVectors`/
`addDocuments` failure — present so a caller (especially one relying
on auto-generated ids, which are otherwise lost entirely on failure)
can find and clean up or reconcile vectors that already landed.
