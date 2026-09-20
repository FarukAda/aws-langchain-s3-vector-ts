[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverInput

# Type Alias: AmazonS3VectorsRetrieverInput\<V\>

> **AmazonS3VectorsRetrieverInput**\<`V`\> = `VectorStoreRetrieverInput`\<`V`\> & `object`

Defined in: [retriever.ts:171](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L171)

What [AmazonS3VectorsRetriever](../classes/AmazonS3VectorsRetriever.md)'s **constructor** takes — core's own
`VectorStoreRetrieverInput` plus the two fields this package adds.

Distinct from [AmazonS3VectorsRetrieverFields](../interfaces/AmazonS3VectorsRetrieverFields.md), which is what
[AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) takes. The two overlap but are not the
same: this one carries core's `vectorStore`, because a constructor is handed
the store it reads from, and `asRetriever` already knows it.

The two added fields are `readonly` to match every other published option
type here; core's own fields are as core declares them.

## Type Declaration

### scoreThreshold?

> `readonly` `optional` **scoreThreshold?**: `number`

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)
