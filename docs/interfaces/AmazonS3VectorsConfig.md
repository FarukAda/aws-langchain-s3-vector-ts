[**AWS LangChain S3 Vector TypeScript v0.6.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsConfig

# Interface: AmazonS3VectorsConfig

Defined in: [types.ts:19](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L19)

Configuration options for the [AmazonS3Vectors](../classes/AmazonS3Vectors.md) vector store.

At minimum, `vectorBucketName` and `indexName` are required.
Either `embeddings` or `client` (or both) should be provided depending
on the intended usage pattern.

## Properties

### client?

> `readonly` `optional` **client?**: `S3VectorsClient`

Defined in: [types.ts:99](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L99)

A pre-configured `S3VectorsClient` instance.
When provided, `region`, `credentials`, and `endpoint` are ignored.

***

### createIndexIfNotExist?

> `readonly` `optional` **createIndexIfNotExist?**: `boolean`

Defined in: [types.ts:67](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L67)

When `true`, the index is created automatically if it does not exist
on the first `addVectors` / `addDocuments` call.

#### Default Value

`true`

***

### credentials?

> `readonly` `optional` **credentials?**: `AwsCredentialIdentity` \| `AwsCredentialIdentityProvider`

Defined in: [types.ts:108](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L108)

AWS credentials: either a static credential object or an async
provider function — the same shape `S3VectorsClient` itself accepts.

***

### dataType?

> `readonly` `optional` **dataType?**: `"float32"`

Defined in: [types.ts:36](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L36)

Data type for the vectors stored in the index.

#### Default Value

`"float32"`

***

### distanceMetric?

> `readonly` `optional` **distanceMetric?**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [types.ts:42](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L42)

Distance metric used for similarity search.

#### Default Value

`"cosine"`

***

### embeddings?

> `readonly` `optional` **embeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: [types.ts:82](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L82)

Embedding model used for both indexing and querying.
Required unless you only call methods that accept raw vectors.

***

### endpoint?

> `readonly` `optional` **endpoint?**: `string`

Defined in: [types.ts:111](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L111)

Custom endpoint URL to use instead of the default regional endpoint.

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [types.ts:30](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L30)

Name of the vector index inside the bucket.
Must be 3–63 characters, start and end with a letter or number,
and contain only lowercase letters, numbers, hyphens, and dots.

***

### maxAttempts?

> `readonly` `optional` **maxAttempts?**: `number`

Defined in: [types.ts:117](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L117)

Maximum number of attempts (initial try + retries) for AWS requests.
Forwarded to the AWS SDK retry strategy. Ignored when `client` is provided.

***

### nonFilterableMetadataKeys?

> `readonly` `optional` **nonFilterableMetadataKeys?**: `string`[]

Defined in: [types.ts:48](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L48)

Metadata keys that should **not** be filterable in queries.
All other metadata keys are filterable by default.

***

### pageContentMetadataKey?

> `readonly` `optional` **pageContentMetadataKey?**: `string` \| `null`

Defined in: [types.ts:60](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L60)

Metadata key under which to store the document `page_content`.

- When set (default `"_page_content"`), the text is stored alongside
  user-provided metadata and restored when reading documents back.
- When `null`, page content is embedded but stored as an empty string
  (useful when you want to minimise metadata size).

#### Default Value

`"_page_content"`

***

### queryEmbeddings?

> `readonly` `optional` **queryEmbeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: [types.ts:91](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L91)

Separate embedding model used exclusively for queries.
Useful when the embedding provider differentiates between
document-embedding and query-embedding tasks.

Falls back to [embeddings](#embeddings) when not set.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [types.ts:102](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L102)

AWS region to use when creating the SDK client (e.g. `"us-east-1"`).

***

### relevanceScoreFn?

> `readonly` `optional` **relevanceScoreFn?**: (`distance`) => `number`

Defined in: [types.ts:74](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L74)

Optional custom function that converts a raw distance value into a
relevance score. If not provided, a built-in function is selected
based on the configured [distanceMetric](#distancemetric).

#### Parameters

##### distance

`number`

#### Returns

`number`

***

### retryMode?

> `readonly` `optional` **retryMode?**: `"standard"` \| `"adaptive"` \| `"legacy"`

Defined in: [types.ts:123](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L123)

AWS SDK retry mode. Throttling and 5xx errors are retried by the SDK.
Ignored when `client` is provided.

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [types.ts:23](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/types.ts#L23)

Name of an existing S3 vector bucket. Must be created manually beforehand.
