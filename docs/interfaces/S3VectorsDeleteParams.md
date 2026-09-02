[**AWS LangChain S3 Vector TypeScript v0.9.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteParams

# Interface: S3VectorsDeleteParams

Defined in: [types.ts:193](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/types.ts#L193)

Options accepted by [AmazonS3Vectors.delete](../classes/AmazonS3Vectors.md#delete).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:200](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/types.ts#L200)

Batch size for `DeleteVectors` calls.

#### Default Value

`500`

***

### deleteAll?

> `readonly` `optional` **deleteAll?**: `true`

Defined in: [types.ts:206](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/types.ts#L206)

Must be explicitly `true` to delete the **entire index** (used together
with omitting `ids`). Guards against an accidentally-`undefined` `ids`
array silently wiping the whole index.

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:195](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/types.ts#L195)

Vector IDs to delete. Omit together with [deleteAll](#deleteall) to delete the entire index.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:211](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/types.ts#L211)

Abort an in-progress delete. Cancels the `DeleteVectors`/`DeleteIndex`
call currently in flight and stops any further batches from starting.
