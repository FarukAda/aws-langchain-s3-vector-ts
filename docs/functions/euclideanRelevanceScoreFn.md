[**AWS LangChain S3 Vector TypeScript v0.8.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / euclideanRelevanceScoreFn

# Function: euclideanRelevanceScoreFn()

> **euclideanRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:38](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/5526645d86515769218984de46407a0d79ff536d/src/relevance-scores.ts#L38)

Convert a **euclidean distance** to a relevance score, using the same
heuristic as the Python `langchain-aws` reference implementation.

## Parameters

### distance

`number`

## Returns

`number`

## Remarks

Despite the metric's name, S3 Vectors' `euclidean` distance is
**squared** L2, not linear L2 (confirmed against the live service: a
point at true L2 distance 3 from the query returns a raw distance of
9, not 3). This formula divides that squared value by a linear scale
(`sqrt(maxDimension)`), so — unlike the cosine conversion — the result
is **not** reliably bounded to [0, 1]: for unit-normalised embeddings
(the common case) scores land in a narrow band close to 1 rather than
spanning the full range, and for unnormalised or high-magnitude
embeddings the score can go negative. Provide a custom
`relevanceScoreFn` if you need threshold-able euclidean scores.
