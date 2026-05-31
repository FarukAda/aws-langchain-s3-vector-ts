[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / cosineRelevanceScoreFn

# Function: cosineRelevanceScoreFn()

> **cosineRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:15](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/relevance-scores.ts#L15)

Convert a **cosine distance** (range [0, 2]) to a relevance score [−1, 1].

For normalised embeddings the distance is in [0, 2] so the score lands in
[−1, 1], but in practice most embedding models produce scores in [0, 1].

## Parameters

### distance

`number`

## Returns

`number`
