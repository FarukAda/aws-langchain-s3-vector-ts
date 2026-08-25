[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorContext

# Interface: S3VectorsErrorContext

Defined in: [shared/errors/s3-vectors-error.ts:4](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/shared/errors/s3-vectors-error.ts#L4)

Structured context attached to every [S3VectorsError](../classes/S3VectorsError.md).

## Properties

### indexName?

> `readonly` `optional` **indexName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/shared/errors/s3-vectors-error.ts#L8)

***

### operation

> `readonly` **operation**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:6](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/shared/errors/s3-vectors-error.ts#L6)

The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`).

***

### vectorBucketName?

> `readonly` `optional` **vectorBucketName?**: `string`

Defined in: [shared/errors/s3-vectors-error.ts:7](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/shared/errors/s3-vectors-error.ts#L7)
