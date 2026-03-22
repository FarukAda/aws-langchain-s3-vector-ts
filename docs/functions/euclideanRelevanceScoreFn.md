[**AWS LangChain S3 Vector TypeScript v0.1.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / euclideanRelevanceScoreFn

# Function: euclideanRelevanceScoreFn()

> **euclideanRelevanceScoreFn**(`distance`): `number`

Defined in: utils.ts:25

Convert a **euclidean distance** to a relevance score [0, 1].

The upper bound uses the maximum dimension supported by S3 Vectors (4 096).
This is the same heuristic used by the Python `langchain-aws` library.

## Parameters

### distance

`number`

## Returns

`number`
