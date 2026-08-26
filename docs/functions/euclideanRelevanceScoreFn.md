[**AWS LangChain S3 Vector TypeScript v0.3.2**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / euclideanRelevanceScoreFn

# Function: euclideanRelevanceScoreFn()

> **euclideanRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:25](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/1172081fcf5a7d61bb638c355c1836716034a899/src/relevance-scores.ts#L25)

Convert a **euclidean distance** to a relevance score [0, 1].

The upper bound uses the maximum dimension supported by S3 Vectors (4 096).
This is the same heuristic used by the Python `langchain-aws` library.

## Parameters

### distance

`number`

## Returns

`number`
