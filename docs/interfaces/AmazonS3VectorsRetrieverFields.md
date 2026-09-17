[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverFields

# Interface: AmazonS3VectorsRetrieverFields\<V\>

Defined in: [retriever.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L18)

Fields [AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) accepts: everything
`@langchain/core` documents, plus `signal`.

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

## Properties

### callbacks?

> `readonly` `optional` **callbacks?**: `Callbacks`

Defined in: [retriever.ts:43](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L43)

Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*.

***

### filter?

> `readonly` `optional` **filter?**: `V`\[`"FilterType"`\]

Defined in: [retriever.ts:22](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L22)

Metadata filter applied to every search this retriever runs.

***

### k?

> `readonly` `optional` **k?**: `number`

Defined in: [retriever.ts:20](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L20)

Documents to retrieve per query.

#### Default Value

`4`

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [retriever.ts:39](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L39)

Run metadata, passed through to core's callback machinery unchanged.

***

### searchKwargs?

> `readonly` `optional` **searchKwargs?**: `VectorStoreRetrieverMMRSearchKwargs`

Defined in: [retriever.ts:26](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L26)

`fetchK` and `lambda`, honoured only when `searchType` is `'mmr'`.

***

### searchType?

> `readonly` `optional` **searchType?**: `"similarity"` \| `"mmr"`

Defined in: [retriever.ts:24](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L24)

`'similarity'` (default) or `'mmr'`.

#### Default Value

`'similarity'`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [retriever.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L35)

Cancels the AWS requests this retriever makes — genuinely, because a
retriever field needs no per-invocation state and so can be threaded into
`QueryVectors` and `GetVectors`. Distinct from the signal on
`invoke(query, { signal })`, which core never routes to a retriever's
extension point and which therefore ends the invocation without cancelling
the request already in flight.

***

### tags?

> `readonly` `optional` **tags?**: `string`[]

Defined in: [retriever.ts:37](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L37)

Run tags. This store's type is appended to whatever is given, as core does.

***

### verbose?

> `readonly` `optional` **verbose?**: `boolean`

Defined in: [retriever.ts:41](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L41)

Core's verbose flag, passed through unchanged.
