[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / cosineRelevanceScoreFn

# Function: cosineRelevanceScoreFn()

> **cosineRelevanceScoreFn**(`distance`): `number`

Defined in: [relevance-scores.ts:25](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/relevance-scores.ts#L25)

Convert a cosine distance to a LangChain relevance score.

Accepts: a distance as S3 Vectors returns it for a cosine index. That value
is exactly `1 − cosine_similarity`, measured against the live service
(`docs/evidence/cosine-distance.md`), so its range is [0, 2].

Returns: `1 − distance`, the exact inverse — so the range is [−1, 1], and
[0, 1] for the normalised embeddings most models produce. A caller
thresholding at 0 is asking for "no worse than orthogonal".

Throws: nothing. A non-numeric distance cannot reach here: the search path
rejects a result without a finite numeric distance before scoring it.

## Parameters

### distance

`number`

## Returns

`number`
