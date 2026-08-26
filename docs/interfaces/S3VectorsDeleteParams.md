[**AWS LangChain S3 Vector TypeScript v0.4.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: [types.ts:137](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/d7575aa8ad569378d6f3a49b62cfadee23c132c5/src/types.ts#L137)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:144](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/d7575aa8ad569378d6f3a49b62cfadee23c132c5/src/types.ts#L144)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### deleteAll?

> `readonly` `optional` **deleteAll?**: `true`

Defined in: [types.ts:150](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/d7575aa8ad569378d6f3a49b62cfadee23c132c5/src/types.ts#L150)

Must be explicitly `true` to delete the **entire index** (used together
with omitting `ids`). Guards against an accidentally-`undefined` `ids`
array silently wiping the whole index.

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:139](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/d7575aa8ad569378d6f3a49b62cfadee23c132c5/src/types.ts#L139)

Vector IDs to delete. Omit together with [deleteAll](#deleteall) to delete the entire index.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:155](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/d7575aa8ad569378d6f3a49b62cfadee23c132c5/src/types.ts#L155)

Abort an in-progress delete. Cancels the `DeleteVectors`/`DeleteIndex`
call currently in flight and stops any further batches from starting.
