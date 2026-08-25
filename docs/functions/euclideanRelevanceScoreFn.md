[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / euclideanRelevanceScoreFn

# Function: euclideanRelevanceScoreFn()

> **euclideanRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:25](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/relevance-scores.ts#L25)

Convert a **euclidean distance** to a relevance score [0, 1].

The upper bound uses the maximum dimension supported by S3 Vectors (4 096).
This is the same heuristic used by the Python `langchain-aws` library.

## Parameters

### distance

`number`

## Returns

`number`
