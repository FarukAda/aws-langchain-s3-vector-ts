[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsConfig

# Interface: AmazonS3VectorsConfig

Defined in: [types.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L27)

Configuration options for the [AmazonS3Vectors](../classes/AmazonS3Vectors.md) vector store.

`vectorBucketName` and `indexName` are required; everything else has a
default or is optional. `embeddings` and `client` are not alternatives to
one another: `embeddings` decides whether the text-taking methods work at
all (without it they raise `EMBEDDINGS_MISSING`, while the vector-taking
ones are unaffected), and `client` decides whether this store builds its own
SDK client or uses yours.

## Properties

### client?

> `readonly` `optional` **client?**: `S3VectorsClient`

Defined in: [types.ts:167](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L167)

A pre-configured `S3VectorsClient` instance.

Exclusive with every option that would configure one: supplying it
together with `region`, `credentials`, `endpoint`, `maxAttempts`,
`retryMode`, `connectionTimeout`, `socketTimeout` or `requestTimeout` is
rejected with `VALIDATION` rather than silently resolved in the client's
favour.

***

### connectionTimeout?

> `readonly` `optional` **connectionTimeout?**: `number`

Defined in: [types.ts:207](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L207)

Milliseconds the connection phase of a request may take before it is
abandoned, defaulting to 5,000. `0` disables it. Not accepted together
with `client`, which carries its own request handler.

***

### createIndexIfNotExist?

> `readonly` `optional` **createIndexIfNotExist?**: `boolean`

Defined in: [types.ts:83](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L83)

When `true`, the index is created automatically if it does not exist
on the first `addVectors` / `addDocuments` call: that write issues one
`GetIndex` and, when the index is missing, one `CreateIndex`.

When `false`, neither call is made. Nothing is checked there that AWS
does not already enforce on the write itself, so a store that never
creates an index needs no control-plane permission at all — a missing
index simply fails at `PutVectors`.

#### Default Value

`true`

***

### credentials?

> `readonly` `optional` **credentials?**: `AwsCredentialIdentity` \| `AwsCredentialIdentityProvider`

Defined in: [types.ts:180](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L180)

AWS credentials: either a static credential object or an async
provider function — the same shape `S3VectorsClient` itself accepts.
Not accepted together with `client`.

***

### dataType?

> `readonly` `optional` **dataType?**: `"float32"`

Defined in: [types.ts:44](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L44)

Data type for the vectors stored in the index.

#### Default Value

`"float32"`

***

### distanceMetric?

> `readonly` `optional` **distanceMetric?**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [types.ts:50](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L50)

Distance metric used for similarity search.

#### Default Value

`"cosine"`

***

### embeddings?

> `readonly` `optional` **embeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: [types.ts:145](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L145)

Embedding model used for both indexing and querying.
Required unless you only call methods that accept raw vectors.

***

### encryptionConfiguration?

> `readonly` `optional` **encryptionConfiguration?**: `EncryptionConfiguration`

Defined in: [types.ts:98](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L98)

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

Defined in: [types.ts:186](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L186)

Custom endpoint URL to use instead of the default regional endpoint.
Not accepted together with `client`.

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [types.ts:38](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L38)

Name of the vector index inside the bucket.
Must be 3–63 characters, start and end with a letter or number,
and contain only lowercase letters, numbers, hyphens, and dots.

***

### maxAttempts?

> `readonly` `optional` **maxAttempts?**: `number`

Defined in: [types.ts:193](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L193)

Maximum number of attempts (initial try + retries) for AWS requests.
Forwarded to the AWS SDK retry strategy. Not accepted together with
`client`, which carries its own.

***

### maxConcurrentBatchCalls?

> `readonly` `optional` **maxConcurrentBatchCalls?**: `number`

Defined in: [types.ts:121](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L121)

Maximum number of `PutVectors` / `DeleteVectors` / `GetVectors`
calls this store keeps in flight at once during a batched
`addDocuments`, `addVectors`, `delete({ ids })` or `getByIds`.

Raise it to ingest faster against a generous account-level rate
limit; lower it (down to `1` for strictly sequential calls) if you
share the account's S3 Vectors request quota with other workloads or
see sustained `TooManyRequestsException`s even with the SDK's own retries.
Peak memory for in-flight write payloads scales with
`maxConcurrentBatchCalls × batchSize`.

#### Default Value

`10`

***

### nonFilterableMetadataKeys?

> `readonly` `optional` **nonFilterableMetadataKeys?**: `string`[]

Defined in: [types.ts:56](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L56)

Metadata keys that should **not** be filterable in queries.
All other metadata keys are filterable by default.

***

### pageContentMetadataKey?

> `readonly` `optional` **pageContentMetadataKey?**: `string` \| `null`

Defined in: [types.ts:70](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L70)

Metadata key under which to store the document `page_content`.

- When set (default `"_page_content"`), the text is stored alongside
  user-provided metadata and restored when reading documents back.
- When `null`, page content is embedded but **not stored at all**: no key
  is written for it, and a document read back has an empty `pageContent`.
  Useful when you want to minimise metadata size, and the only way to keep
  page content out of the 40 KB per-vector budget entirely.

#### Default Value

`"_page_content"`

***

### queryEmbeddings?

> `readonly` `optional` **queryEmbeddings?**: `EmbeddingsInterface`\<`number`[]\>

Defined in: [types.ts:154](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L154)

Separate embedding model used exclusively for queries.
Useful when the embedding provider differentiates between
document-embedding and query-embedding tasks.

Falls back to [embeddings](#embeddings) when not set.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [types.ts:173](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L173)

AWS region to use when creating the SDK client (e.g. `"us-east-1"`).
Not accepted together with `client`.

***

### relevanceScoreFn?

> `readonly` `optional` **relevanceScoreFn?**: (`distance`) => `number`

Defined in: [types.ts:137](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L137)

Converts a raw distance into a relevance score, for
`similaritySearchWithRelevanceScores` and the retriever's score
threshold. Nothing else uses it: `similaritySearchWithScore` returns the
service's distance untouched.

Omitting it is only safe on a cosine index, where the built-in
`cosineRelevanceScoreFn` is the exact inverse of what the service
returns. A **euclidean** index has no built-in: euclidean distance is
unbounded above, so no fixed formula maps it to a comparable score
without knowing the embedding's scale, which only you know. Asking for
relevance scores on a euclidean index without this option raises
`VALIDATION` rather than returning numbers comparable against nothing.

#### Parameters

##### distance

`number`

#### Returns

`number`

***

### requestTimeout?

> `readonly` `optional` **requestTimeout?**: `number`

Defined in: [types.ts:237](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L237)

Milliseconds a whole request and response may take, as a **total
deadline**. No default, and `0` disables it. Not accepted together with
`client`.

Deliberately not defaulted: a 500-vector batch at 4,096 dimensions is a
large upload, and a deadline would end it however healthy the transfer is.
Set it only when a hard ceiling is what you want.

Setting it also sets the SDK's `throwOnRequestTimeout`. Without that flag
the SDK emits a warning and keeps waiting, so the option would otherwise
mean something other than what its name says.

***

### retryMode?

> `readonly` `optional` **retryMode?**: `"standard"` \| `"adaptive"` \| `"legacy"`

Defined in: [types.ts:200](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L200)

AWS SDK retry mode. Throttling (`TooManyRequestsException`) and 5xx errors
are retried by the SDK. Not accepted together with `client`, which carries
its own.

***

### socketTimeout?

> `readonly` `optional` **socketTimeout?**: `number`

Defined in: [types.ts:222](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L222)

Milliseconds a socket may sit **idle** before the request is failed,
defaulting to 60,000. `0` disables it. Not accepted together with
`client`.

This is the timeout that ends a request to an endpoint which accepts the
connection and then never answers. It is idle-based, so it does not
interrupt a large upload that is still making progress — which is why it,
rather than [requestTimeout](#requesttimeout), is the one with a default.

A `TimeoutError` from this is retryable, so the worst-case wait for a
black-holed endpoint is `maxAttempts` times this value, plus backoff.

***

### tags?

> `readonly` `optional` **tags?**: `Record`\<`string`, `string`\>

Defined in: [types.ts:106](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L106)

Tags to apply to an index this store creates (`createIndexIfNotExist:
true`), for cost allocation or attribute-based access control.
Forwarded verbatim to `CreateIndex` (`Record<string, string>`, up to
AWS's 50-tag limit). Ignored for an index that already exists.

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [types.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L31)

Name of an existing S3 vector bucket. Must be created manually beforehand.
