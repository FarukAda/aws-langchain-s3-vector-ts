[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteOptions

# Interface: S3VectorsDeleteOptions

Defined in: [types.ts:412](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L412)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:423](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L423)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### ids

> `readonly` **ids**: readonly `string`[]

Defined in: [types.ts:418](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L418)

The vector ids to delete. Required: `delete` removes vectors, and nothing
else. Destroying the index is [AmazonS3Vectors.deleteIndex](../classes/AmazonS3Vectors.md#deleteindex), which
has to be named to be called.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:428](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L428)

Abort an in-progress delete. Cancels the `DeleteVectors` call currently in
flight and stops any further batches from starting.
