[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsConfig

# Interface: AmazonS3VectorsConfig

Defined in: [types.ts:24](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L24)

Configuration options for the [AmazonS3Vectors](../classes/AmazonS3Vectors.md) vector store.

At minimum, `vectorBucketName` and `indexName` are required.
Either `embeddings` or `client` (or both) should be provided depending
on the intended usage pattern.

## Properties

### client?

> `readonly` `optional` **client?**: `S3VectorsClient`

Defined in: [types.ts:149](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L149)

A pre-configured `S3VectorsClient` instance.
When provided, `region`, `credentials`, and `endpoint` are ignored.

***

### createIndexIfNotExist?

> `readonly` `optional` **createIndexIfNotExist?**: `boolean`

Defined in: [types.ts:79](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L79)

When `true`, the index is created automatically if it does not exist
on the first `addVectors` / `addDocuments` call.

Note that `false` does **not** remove the need for `s3vectors:GetIndex`
permission: every first write on an instance calls `GetIndex` once to
validate the index's dimension and distance metric against this
store's configuration, regardless of this flag. The flag only controls
whether a *missing* index is created (`CreateIndex`) or left to fail
at `PutVectors`.

#### Default Value

`true`

***

### credentials?

> `readonly` `optional` **credentials?**: `AwsCredentialIdentity` \| `AwsCredentialIdentityProvider`

Defined in: [types.ts:158](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L158)

AWS credentials: either a static credential object or an async
provider function — the same shape `S3VectorsClient` itself accepts.

***

### dataType?

> `readonly` `optional` **dataType?**: `"float32"`

Defined in: [types.ts:41](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L41)

Data type for the vectors stored in the index.

#### Default Value

`"float32"`

***

### distanceMetric?

> `readonly` `optional` **distanceMetric?**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [types.ts:47](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L47)

Distance metric used for similarity search.

#### Default Value

`"cosine"`

***

### embeddings?

> `readonly` `optional` **embeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: [types.ts:132](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L132)

Embedding model used for both indexing and querying.
Required unless you only call methods that accept raw vectors.

***

### encryptionConfiguration?

> `readonly` `optional` **encryptionConfiguration?**: `EncryptionConfiguration`

Defined in: [types.ts:94](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L94)

Server-side encryption to request for an index this store creates
(`createIndexIfNotExist: true`). Forwarded verbatim to `CreateIndex`;
accepts the SDK's own shape, e.g. `{ sseType: 'aws:kms', kmsKeyArn: '…' }`.
Ignored for an index that already exists — S3 Vectors has no
`UpdateIndex`, so encryption is fixed at creation.

When omitted, AWS applies the vector bucket's default encryption
(`AES256` unless the bucket was configured otherwise). Set this if
your organisation requires a customer-managed KMS key on every index,
or pre-create the index with your own tooling and use
`createIndexIfNotExist: false`.

***

### endpoint?

> `readonly` `optional` **endpoint?**: `string`

Defined in: [types.ts:161](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L161)

Custom endpoint URL to use instead of the default regional endpoint.

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [types.ts:35](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L35)

Name of the vector index inside the bucket.
Must be 3–63 characters, start and end with a letter or number,
and contain only lowercase letters, numbers, hyphens, and dots.

***

### maxAttempts?

> `readonly` `optional` **maxAttempts?**: `number`

Defined in: [types.ts:167](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L167)

Maximum number of attempts (initial try + retries) for AWS requests.
Forwarded to the AWS SDK retry strategy. Ignored when `client` is provided.

***

### maxConcurrentBatchCalls?

> `readonly` `optional` **maxConcurrentBatchCalls?**: `number`

Defined in: [types.ts:117](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L117)

Maximum number of `PutVectors` / `DeleteVectors` / `GetVectors`
calls this store keeps in flight at once during a batched
`addDocuments`, `addVectors`, `delete({ ids })` or `getByIds`.

Raise it to ingest faster against a generous account-level rate
limit; lower it (down to `1` for strictly sequential calls) if you
share the account's S3 Vectors request quota with other workloads or
see sustained `ThrottlingException`s even with the SDK's own retries.
Peak memory for in-flight write payloads scales with
`maxConcurrentBatchCalls × batchSize`.

#### Default Value

`10`

***

### nonFilterableMetadataKeys?

> `readonly` `optional` **nonFilterableMetadataKeys?**: `string`[]

Defined in: [types.ts:53](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L53)

Metadata keys that should **not** be filterable in queries.
All other metadata keys are filterable by default.

***

### pageContentMetadataKey?

> `readonly` `optional` **pageContentMetadataKey?**: `string` \| `null`

Defined in: [types.ts:65](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L65)

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

Defined in: [types.ts:141](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L141)

Separate embedding model used exclusively for queries.
Useful when the embedding provider differentiates between
document-embedding and query-embedding tasks.

Falls back to [embeddings](#embeddings) when not set.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [types.ts:152](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L152)

AWS region to use when creating the SDK client (e.g. `"us-east-1"`).

***

### relevanceScoreFn?

> `readonly` `optional` **relevanceScoreFn?**: (`distance`) => `number`

Defined in: [types.ts:124](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L124)

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

Defined in: [types.ts:173](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L173)

AWS SDK retry mode. Throttling and 5xx errors are retried by the SDK.
Ignored when `client` is provided.

***

### tags?

> `readonly` `optional` **tags?**: `Record`\<`string`, `string`\>

Defined in: [types.ts:102](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L102)

Tags to apply to an index this store creates (`createIndexIfNotExist:
true`), for cost allocation or attribute-based access control.
Forwarded verbatim to `CreateIndex` (`Record<string, string>`, up to
AWS's 50-tag limit). Ignored for an index that already exists.

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [types.ts:28](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L28)

Name of an existing S3 vector bucket. Must be created manually beforehand.
