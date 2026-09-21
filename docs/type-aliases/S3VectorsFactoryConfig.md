[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsFactoryConfig

# Type Alias: S3VectorsFactoryConfig

> **S3VectorsFactoryConfig** = [`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md) & [`S3VectorsAddOptions`](../interfaces/S3VectorsAddOptions.md)

Defined in: [types.ts:394](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L394)

The argument [AmazonS3Vectors.fromTexts](../classes/AmazonS3Vectors.md#fromtexts) and
[AmazonS3Vectors.fromDocuments](../classes/AmazonS3Vectors.md#fromdocuments) take: a store configuration and the
write options for the one write the factory performs, in one object.

They travel together because a factory both builds the store and writes with
it. The store keeps only the configuration half — the ids and the signal are
stripped before construction, so a million-id list does not stay on the
instance for its lifetime through `lc_kwargs`.
