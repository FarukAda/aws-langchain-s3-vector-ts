[**AWS LangChain S3 Vector TypeScript v0.1.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: types.ts:126

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: types.ts:133

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: types.ts:128

Vector IDs to delete. When `undefined`, the entire index is deleted.
