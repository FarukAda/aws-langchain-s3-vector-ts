[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteOptions

# Interface: S3VectorsDeleteOptions

Defined in: [types.ts:397](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L397)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:408](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L408)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### ids

> `readonly` **ids**: `string`[]

Defined in: [types.ts:403](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L403)

The vector ids to delete. Required: `delete` removes vectors, and nothing
else. Destroying the index is [AmazonS3Vectors.deleteIndex](../classes/AmazonS3Vectors.md#deleteindex), which
has to be named to be called.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:413](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L413)

Abort an in-progress delete. Cancels the `DeleteVectors` call currently in
flight and stops any further batches from starting.
