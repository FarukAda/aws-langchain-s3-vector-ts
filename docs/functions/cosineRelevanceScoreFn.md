[**AWS LangChain S3 Vector TypeScript v0.5.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / cosineRelevanceScoreFn

# Function: cosineRelevanceScoreFn()

> **cosineRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/e93cf23e181d1dfa63d42b4d0ea21a569ef421dd/src/relevance-scores.ts#L18)

Convert a **cosine distance** (range [0, 2]) to a relevance score [−1, 1].

For normalised embeddings the distance is in [0, 2] so the score lands in
[−1, 1], but in practice most embedding models produce scores in [0, 1].

## Parameters

### distance

`number`

## Returns

`number`
