[**AWS LangChain S3 Vector TypeScript v0.3.2**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / cosineRelevanceScoreFn

# Function: cosineRelevanceScoreFn()

> **cosineRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:15](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/362fd079c5200b58a23c5398fc2d6b722cdcc25c/src/relevance-scores.ts#L15)

Convert a **cosine distance** (range [0, 2]) to a relevance score [−1, 1].

For normalised embeddings the distance is in [0, 2] so the score lands in
[−1, 1], but in practice most embedding models produce scores in [0, 1].

## Parameters

### distance

`number`

## Returns

`number`
