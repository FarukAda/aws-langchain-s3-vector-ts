[**AWS LangChain S3 Vector TypeScript v0.1.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / cosineRelevanceScoreFn

# Function: cosineRelevanceScoreFn()

> **cosineRelevanceScoreFn**(`distance`): `number`

Defined in: utils.ts:15

Convert a **cosine distance** (range [0, 2]) to a relevance score [−1, 1].

For normalised embeddings the distance is in [0, 2] so the score lands in
[−1, 1], but in practice most embedding models produce scores in [0, 1].

## Parameters

### distance

`number`

## Returns

`number`
