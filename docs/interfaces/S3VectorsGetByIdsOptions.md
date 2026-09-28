[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsGetByIdsOptions

# Interface: S3VectorsGetByIdsOptions

Defined in: [types.ts:390](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L390)

Options accepted by [AmazonS3Vectors.getByIds](../classes/AmazonS3Vectors.md#getbyids).

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:395](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L395)

Ids per `GetVectors` request, 1–100.

#### Default Value

`100`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:397](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L397)

Cancels the read. Ids already fetched are reported in `error.context.foundIds`.
