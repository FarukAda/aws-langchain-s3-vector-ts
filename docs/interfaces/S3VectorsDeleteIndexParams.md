[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsDeleteIndexParams

# Interface: S3VectorsDeleteIndexParams

Defined in: [types.ts:342](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L342)

Options accepted by [AmazonS3Vectors.deleteIndex](../classes/AmazonS3Vectors.md#deleteindex).

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:348](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L348)

Abort the deletion. An already-fired signal rejects before any request;
one that fires while an index creation is being awaited ends this
caller's wait without cancelling that shared work.
