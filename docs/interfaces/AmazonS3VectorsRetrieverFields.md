[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetrieverFields

# Interface: AmazonS3VectorsRetrieverFields\<V\>

Defined in: retriever.ts:17

Fields [AmazonS3Vectors.asRetriever](../classes/AmazonS3Vectors.md#asretriever) accepts: everything
`@langchain/core` documents, plus `signal`.

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md) = [`AmazonS3Vectors`](../classes/AmazonS3Vectors.md)

## Properties

### callbacks?

> `readonly` `optional` **callbacks?**: `Callbacks`

Defined in: retriever.ts:38

***

### filter?

> `readonly` `optional` **filter?**: `V`\[`"FilterType"`\]

Defined in: retriever.ts:21

Metadata filter applied to every search this retriever runs.

***

### k?

> `readonly` `optional` **k?**: `number`

Defined in: retriever.ts:19

Documents to retrieve per query.

#### Default Value

`4`

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: retriever.ts:36

***

### searchKwargs?

> `readonly` `optional` **searchKwargs?**: `VectorStoreRetrieverMMRSearchKwargs`

Defined in: retriever.ts:25

`fetchK` and `lambda`, honoured only when `searchType` is `'mmr'`.

***

### searchType?

> `readonly` `optional` **searchType?**: `"similarity"` \| `"mmr"`

Defined in: retriever.ts:23

`'similarity'` (default) or `'mmr'`.

#### Default Value

`'similarity'`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: retriever.ts:34

Cancels the AWS requests this retriever makes — genuinely, because a
retriever field needs no per-invocation state and so can be threaded into
`QueryVectors` and `GetVectors`. Distinct from the signal on
`invoke(query, { signal })`, which core never routes to a retriever's
extension point and which therefore ends the invocation without cancelling
the request already in flight.

***

### tags?

> `readonly` `optional` **tags?**: `string`[]

Defined in: retriever.ts:35

***

### verbose?

> `readonly` `optional` **verbose?**: `boolean`

Defined in: retriever.ts:37
