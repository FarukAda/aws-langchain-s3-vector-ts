[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsGetByIdsOptions

# Interface: S3VectorsGetByIdsOptions

Defined in: [types.ts:389](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L389)

Options accepted by [AmazonS3Vectors.getByIds](../classes/AmazonS3Vectors.md#getbyids).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:394](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L394)

Ids per `GetVectors` request, 1–100.

#### Default Value

`100`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:396](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L396)

Cancels the read. Ids already fetched are reported in `error.context.foundIds`.
