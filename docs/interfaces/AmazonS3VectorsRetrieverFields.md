[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverFields

# Interface: AmazonS3VectorsRetrieverFields\<V\>

Defined in: [retriever.ts:17](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L17)

Fields [AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) accepts: everything
`@langchain/core` documents, plus `signal`.

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

## Properties

### callbacks?

> `readonly` `optional` **callbacks?**: `Callbacks`

Defined in: [retriever.ts:42](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L42)

Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*.

***

### filter?

> `readonly` `optional` **filter?**: `V`\[`"FilterType"`\]

Defined in: [retriever.ts:21](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L21)

Metadata filter applied to every search this retriever runs.

***

### k?

> `readonly` `optional` **k?**: `number`

Defined in: [retriever.ts:19](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L19)

Documents to retrieve per query.

#### Default Value

`4`

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [retriever.ts:38](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L38)

Run metadata, passed through to core's callback machinery unchanged.

***

### searchKwargs?

> `readonly` `optional` **searchKwargs?**: `VectorStoreRetrieverMMRSearchKwargs`

Defined in: [retriever.ts:25](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L25)

`fetchK` and `lambda`, honoured only when `searchType` is `'mmr'`.

***

### searchType?

> `readonly` `optional` **searchType?**: `"similarity"` \| `"mmr"`

Defined in: [retriever.ts:23](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L23)

`'similarity'` (default) or `'mmr'`.

#### Default Value

`'similarity'`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [retriever.ts:34](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L34)

Cancels the AWS requests this retriever makes — genuinely, because a
retriever field needs no per-invocation state and so can be threaded into
`QueryVectors` and `GetVectors`. Distinct from the signal on
`invoke(query, { signal })`, which core never routes to a retriever's
extension point and which therefore ends the invocation without cancelling
the request already in flight.

***

### tags?

> `readonly` `optional` **tags?**: `string`[]

Defined in: [retriever.ts:36](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L36)

Run tags. This store's type is appended to whatever is given, as core does.

***

### verbose?

> `readonly` `optional` **verbose?**: `boolean`

Defined in: [retriever.ts:40](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L40)

Core's verbose flag, passed through unchanged.
