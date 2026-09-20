[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverFields

# Interface: AmazonS3VectorsRetrieverFields\<V\>

Defined in: [retriever.ts:110](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L110)

Fields [AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) accepts: everything
`@langchain/core` documents, plus `signal`.

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

## Properties

### callbacks?

> `readonly` `optional` **callbacks?**: `Callbacks`

Defined in: [retriever.ts:151](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L151)

Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*.

***

### filter?

> `readonly` `optional` **filter?**: `V`\[`"FilterType"`\]

Defined in: [retriever.ts:114](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L114)

Metadata filter applied to every search this retriever runs.

***

### k?

> `readonly` `optional` **k?**: `number`

Defined in: [retriever.ts:112](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L112)

Documents to retrieve per query, 1–10,000.

#### Default Value

`4`

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [retriever.ts:147](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L147)

Run metadata, passed through to core's callback machinery unchanged.

***

### scoreThreshold?

> `readonly` `optional` **scoreThreshold?**: `number`

Defined in: [retriever.ts:143](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L143)

Keep only documents whose **relevance score** is at least this — the score
[AmazonS3Vectors.similaritySearchWithRelevanceScores](../classes/AmazonS3Vectors.md#similaritysearchwithrelevancescores) computes, where
higher is better, not the raw distance. At most `k` documents are fetched
and then filtered, so a threshold never widens the search.

Only for `searchType: 'similarity'`; MMR returns documents without scores,
and asking for both is refused. On a euclidean index it needs
`relevanceScoreFn`, and is refused without one when the retriever is built.

`@langchain/classic`'s `ScoreThresholdRetriever` is **not** an alternative
here: it thresholds `similaritySearchWithScore`, which this store answers
with AWS's distance, where lower is better — so it keeps the worst matches
and drops the best.

***

### searchKwargs?

> `readonly` `optional` **searchKwargs?**: `VectorStoreRetrieverMMRSearchKwargs`

Defined in: [retriever.ts:118](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L118)

`fetchK` and `lambda`, honoured — and checked — only when `searchType` is `'mmr'`; `null` means none.

***

### searchType?

> `readonly` `optional` **searchType?**: `"similarity"` \| `"mmr"`

Defined in: [retriever.ts:116](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L116)

`'similarity'` (default) or `'mmr'`; anything else is refused.

#### Default Value

`'similarity'`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [retriever.ts:127](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L127)

Cancels the AWS requests this retriever makes — genuinely, because a
retriever field needs no per-invocation state and so can be threaded into
`QueryVectors` and `GetVectors`. Distinct from the signal on
`invoke(query, { signal })`, which core never routes to a retriever's
extension point and which therefore ends the invocation without cancelling
the request already in flight.

***

### tags?

> `readonly` `optional` **tags?**: `string`[]

Defined in: [retriever.ts:145](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L145)

Run tags. This store's type is appended to whatever is given, as core does.

***

### verbose?

> `readonly` `optional` **verbose?**: `boolean`

Defined in: [retriever.ts:149](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L149)

Core's verbose flag, passed through unchanged.
