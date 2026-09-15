[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsRecord

# Interface: S3VectorsRecord

Defined in: [types.ts:277](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L277)

One record yielded by [AmazonS3Vectors.listVectors](../classes/AmazonS3Vectors.md#listvectors): everything needed
to write the same vector into a different index.

## Properties

### document

> `readonly` **document**: `Document`

Defined in: [types.ts:283](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L283)

The document, mapped exactly as the search paths and `getByIds` map it.

***

### id

> `readonly` **id**: `string`

Defined in: [types.ts:279](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L279)

The vector key, the same value [AmazonS3Vectors.getByIds](../classes/AmazonS3Vectors.md#getbyids) takes.

***

### vector

> `readonly` **vector**: `number`[]

Defined in: [types.ts:281](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L281)

The stored embedding, ready to hand back to `addVectors`.
