[**AWS LangChain S3 Vector TypeScript v0.3.2**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: [types.ts:138](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/362fd079c5200b58a23c5398fc2d6b722cdcc25c/src/types.ts#L138)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:145](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/362fd079c5200b58a23c5398fc2d6b722cdcc25c/src/types.ts#L145)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### deleteAll?

> `readonly` `optional` **deleteAll?**: `true`

Defined in: [types.ts:151](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/362fd079c5200b58a23c5398fc2d6b722cdcc25c/src/types.ts#L151)

Must be explicitly `true` to delete the **entire index** (used together
with omitting `ids`). Guards against an accidentally-`undefined` `ids`
array silently wiping the whole index.

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:140](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/362fd079c5200b58a23c5398fc2d6b722cdcc25c/src/types.ts#L140)

Vector IDs to delete. Omit together with [deleteAll](#deleteall) to delete the entire index.
