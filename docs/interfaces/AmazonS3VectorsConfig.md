[**AWS LangChain S3 Vector TypeScript v0.1.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsConfig

# Interface: AmazonS3VectorsConfig

Defined in: types.ts:19

Configuration options for the [AmazonS3Vectors](../classes/AmazonS3Vectors.md) vector store.

At minimum, `vectorBucketName` and `indexName` are required.
Either `embeddings` or `client` (or both) should be provided depending
on the intended usage pattern.

## Properties

### client?

> `readonly` `optional` **client?**: `S3VectorsClient`

Defined in: types.ts:99

A pre-configured `S3VectorsClient` instance.
When provided, `region`, `credentials`, and `endpoint` are ignored.

***

### createIndexIfNotExist?

> `readonly` `optional` **createIndexIfNotExist?**: `boolean`

Defined in: types.ts:67

When `true`, the index is created automatically if it does not exist
on the first `addVectors` / `addDocuments` call.

#### Default Value

`true`

***

### credentials?

> `readonly` `optional` **credentials?**: `any`

Defined in: types.ts:109

AWS credentials configuration. Accepts any shape compatible with
the AWS SDK credential provider chain.

***

### dataType?

> `readonly` `optional` **dataType?**: `"float32"`

Defined in: types.ts:36

Data type for the vectors stored in the index.

#### Default Value

`"float32"`

***

### distanceMetric?

> `readonly` `optional` **distanceMetric?**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: types.ts:42

Distance metric used for similarity search.

#### Default Value

`"cosine"`

***

### embeddings?

> `readonly` `optional` **embeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: types.ts:82

Embedding model used for both indexing and querying.
Required unless you only call methods that accept raw vectors.

***

### endpoint?

> `readonly` `optional` **endpoint?**: `string`

Defined in: types.ts:112

Custom endpoint URL to use instead of the default regional endpoint.

***

### indexName

> `readonly` **indexName**: `string`

Defined in: types.ts:30

Name of the vector index inside the bucket.
Must be 3–63 characters, start and end with a letter or number,
and contain only lowercase letters, numbers, hyphens, and dots.

***

### nonFilterableMetadataKeys?

> `readonly` `optional` **nonFilterableMetadataKeys?**: `string`[]

Defined in: types.ts:48

Metadata keys that should **not** be filterable in queries.
All other metadata keys are filterable by default.

***

### pageContentMetadataKey?

> `readonly` `optional` **pageContentMetadataKey?**: `string` \| `null`

Defined in: types.ts:60

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

Defined in: types.ts:91

Separate embedding model used exclusively for queries.
Useful when the embedding provider differentiates between
document-embedding and query-embedding tasks.

Falls back to [embeddings](#embeddings) when not set.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: types.ts:102

AWS region to use when creating the SDK client (e.g. `"us-east-1"`).

***

### relevanceScoreFn?

> `readonly` `optional` **relevanceScoreFn?**: (`distance`) => `number`

Defined in: types.ts:74

Optional custom function that converts a raw distance value into a
relevance score. If not provided, a built-in function is selected
based on the configured [distanceMetric](#distancemetric).

#### Parameters

##### distance

`number`

#### Returns

`number`

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: types.ts:23

Name of an existing S3 vector bucket. Must be created manually beforehand.
