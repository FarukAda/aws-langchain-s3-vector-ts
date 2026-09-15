[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsRecord

# Interface: S3VectorsRecord

Defined in: [types.ts:330](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L330)

One record yielded by [AmazonS3Vectors.listVectors](../classes/AmazonS3Vectors.md#listvectors): everything needed
to write the same vector into a different index.

## Properties

### document

> `readonly` **document**: `Document`

Defined in: [types.ts:336](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L336)

The document, mapped exactly as the search paths and `getByIds` map it.

***

### id

> `readonly` **id**: `string`

Defined in: [types.ts:332](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L332)

The vector key, the same value [AmazonS3Vectors.getByIds](../classes/AmazonS3Vectors.md#getbyids) takes.

***

### vector

> `readonly` **vector**: `number`[]

Defined in: [types.ts:334](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L334)

The stored embedding, ready to hand back to `addVectors`.
