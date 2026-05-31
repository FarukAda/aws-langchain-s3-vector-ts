[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: [types.ts:138](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/types.ts#L138)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:145](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/types.ts#L145)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:140](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/types.ts#L140)

Vector IDs to delete. When `undefined`, the entire index is deleted.
