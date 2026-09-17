[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverFields

# Interface: AmazonS3VectorsRetrieverFields\<V\>

Defined in: [retriever.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L27)

Fields [AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) accepts: everything
`@langchain/core` documents, plus `signal`.

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

## Properties

### callbacks?

> `readonly` `optional` **callbacks?**: `Callbacks`

Defined in: [retriever.ts:52](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L52)

Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*.

***

### filter?

> `readonly` `optional` **filter?**: `V`\[`"FilterType"`\]

Defined in: [retriever.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L31)

Metadata filter applied to every search this retriever runs.

***

### k?

> `readonly` `optional` **k?**: `number`

Defined in: [retriever.ts:29](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L29)

Documents to retrieve per query, 1–10,000.

#### Default Value

`4`

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [retriever.ts:48](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L48)

Run metadata, passed through to core's callback machinery unchanged.

***

### searchKwargs?

> `readonly` `optional` **searchKwargs?**: `VectorStoreRetrieverMMRSearchKwargs`

Defined in: [retriever.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L35)

`fetchK` and `lambda`, honoured — and checked — only when `searchType` is `'mmr'`.

***

### searchType?

> `readonly` `optional` **searchType?**: `"similarity"` \| `"mmr"`

Defined in: [retriever.ts:33](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L33)

`'similarity'` (default) or `'mmr'`; anything else is refused.

#### Default Value

`'similarity'`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [retriever.ts:44](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L44)

Cancels the AWS requests this retriever makes — genuinely, because a
retriever field needs no per-invocation state and so can be threaded into
`QueryVectors` and `GetVectors`. Distinct from the signal on
`invoke(query, { signal })`, which core never routes to a retriever's
extension point and which therefore ends the invocation without cancelling
the request already in flight.

***

### tags?

> `readonly` `optional` **tags?**: `string`[]

Defined in: [retriever.ts:46](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L46)

Run tags. This store's type is appended to whatever is given, as core does.

***

### verbose?

> `readonly` `optional` **verbose?**: `boolean`

Defined in: [retriever.ts:50](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L50)

Core's verbose flag, passed through unchanged.
