[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: [types.ts:209](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L209)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:216](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L216)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### deleteAll?

> `readonly` `optional` **deleteAll?**: `true`

Defined in: [types.ts:222](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L222)

Must be explicitly `true` to delete the **entire index** (used together
with omitting `ids`). Guards against an accidentally-`undefined` `ids`
array silently wiping the whole index.

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:211](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L211)

Vector IDs to delete. Omit together with [deleteAll](#deleteall) to delete the entire index.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:227](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L227)

Abort an in-progress delete. Cancels the `DeleteVectors`/`DeleteIndex`
call currently in flight and stops any further batches from starting.
