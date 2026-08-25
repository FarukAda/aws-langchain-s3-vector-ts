[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3Vectors

# Class: AmazonS3Vectors

Defined in: [s3-vectors.ts:87](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L87)

LangChain vector store backed by **Amazon S3 Vectors**.

Provides persistent vector storage, similarity search, and metadata filtering
using the native AWS S3 Vectors service.

## Remarks

Requires an existing S3 vector bucket (created manually via the AWS
console or CLI). The vector index inside the bucket is created
automatically on the first write when [AmazonS3VectorsConfig.createIndexIfNotExist](../interfaces/AmazonS3VectorsConfig.md#createindexifnotexist)
is `true` (the default).

Documents are embedded per batch to keep peak memory usage low for
large document sets, matching the Python `langchain-aws` implementation.

Throttling and transient (5xx) failures are retried automatically by the
AWS SDK; tune this via the `maxAttempts` and `retryMode` config options.

Maximal Marginal Relevance (`maxMarginalRelevanceSearch`) is intentionally
not implemented, matching the Python `langchain-aws` reference — use metadata
pre-filtering or client-side re-ranking if you need diversity.

## Example

```ts
import { AmazonS3Vectors } from "@farukada/aws-langchain-s3-vector-ts";
import { BedrockEmbeddings } from "@langchain/aws";

const store = new AmazonS3Vectors(new BedrockEmbeddings(), {
  vectorBucketName: "my-vector-bucket",
  indexName: "my-index",
  region: "us-east-1",
});

await store.addDocuments([
  new Document({ pageContent: "Star Wars", metadata: { genre: "scifi" } }),
]);

const results = await store.similaritySearch("space adventure", 4);
```

## Extends

- `VectorStore`

## Constructors

### Constructor

> **new AmazonS3Vectors**(`embeddings`, `config`): `AmazonS3Vectors`

Defined in: [s3-vectors.ts:125](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L125)

Create a new Amazon S3 Vectors store

#### Parameters

##### embeddings

`EmbeddingsInterface`\<`number`[]\> \| `undefined`

Embedding model for indexing and querying, or `undefined` for raw-vector workflows

##### config

[`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md)

Configuration options for the store

#### Returns

`AmazonS3Vectors`

#### Overrides

`VectorStore.constructor`

## Properties

### createIndexIfNotExist

> `readonly` **createIndexIfNotExist**: `boolean`

Defined in: [s3-vectors.ts:99](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L99)

***

### dataType

> `readonly` **dataType**: `"float32"`

Defined in: [s3-vectors.ts:95](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L95)

***

### distanceMetric

> `readonly` **distanceMetric**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [s3-vectors.ts:96](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L96)

***

### FilterType

> **FilterType**: `Record`\<`string`, `unknown`\>

Defined in: [s3-vectors.ts:89](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L89)

**`Internal`**

discriminator used by LangChain

#### Overrides

`VectorStore.FilterType`

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [s3-vectors.ts:94](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L94)

***

### nonFilterableMetadataKeys

> `readonly` **nonFilterableMetadataKeys**: `string`[] \| `undefined`

Defined in: [s3-vectors.ts:97](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L97)

***

### pageContentMetadataKey

> `readonly` **pageContentMetadataKey**: `string` \| `null`

Defined in: [s3-vectors.ts:98](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L98)

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [s3-vectors.ts:93](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L93)

## Methods

### \_selectRelevanceScoreFn()

> **\_selectRelevanceScoreFn**(): (`distance`) => `number`

Defined in: [s3-vectors.ts:576](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L576)

**`Internal`**

Select the correct relevance-score function.

#### Returns

(`distance`) => `number`

***

### \_vectorstoreType()

> `abstract` **\_vectorstoreType**(): `string`

Defined in: [s3-vectors.ts:158](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L158)

Returns a string representing the type of vector store, which subclasses
must implement to identify their specific vector storage type.

#### Returns

`string`

A string indicating the vector store type.

#### Overrides

`VectorStore._vectorstoreType`

***

### addDocuments()

> **addDocuments**(`documents`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:233](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L233)

Embed documents and store them in the vector index.

#### Parameters

##### documents

`Document`\<`Record`\<`string`, `any`\>\>[]

Array of documents to embed and store

##### options?

Optional settings

###### batchSize?

`number`

Number of documents per embedding + put batch (default: 200)

###### ids?

`string`[]

Custom IDs for each vector (auto-generated if omitted)

#### Returns

`Promise`\<`string`[]\>

The IDs assigned to each stored vector

#### Remarks

Documents are embedded **per batch** to keep peak memory usage low
for large document sets (matching the Python `langchain-aws` implementation).

#### Throws

Error if count of IDs doesn't match count of documents

#### Overrides

`VectorStore.addDocuments`

***

### addTexts()

> **addTexts**(`texts`, `metadatas?`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:284](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L284)

Add texts (with optional metadata) to the vector store.

#### Parameters

##### texts

`string`[]

Array of text strings to embed and store

##### metadatas?

`Record`\<`string`, `unknown`\>[]

Optional array of metadata objects (one per text)

##### options?

Optional settings

###### batchSize?

`number`

Number of documents per batch (default: 200)

###### ids?

`string`[]

Custom IDs for each vector (auto-generated if omitted)

#### Returns

`Promise`\<`string`[]\>

The IDs assigned to each stored vector

#### Remarks

Convenience method that wraps each text/metadata pair into a
Document and delegates to [addDocuments](#adddocuments).

#### Throws

Error if count of metadatas doesn't match count of texts

***

### addVectors()

> **addVectors**(`vectors`, `documents`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:180](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L180)

Add pre-computed vectors alongside their documents to the store.

#### Parameters

##### vectors

`number`[][]

Array of embedding vectors (one per document)

##### documents

`Document`\<`Record`\<`string`, `any`\>\>[]

Array of documents corresponding to each vector

##### options?

Optional settings

###### batchSize?

`number`

Number of vectors per `PutVectors` call (default: 200)

###### ids?

`string`[]

Custom IDs for each vector (auto-generated if omitted)

#### Returns

`Promise`\<`string`[]\>

The IDs assigned to each stored vector

#### Remarks

Vectors are batched in groups of 200 (default) and sent
via `PutVectorsCommand`. On the first call the index is auto-created
if it does not already exist and `createIndexIfNotExist` is `true`.

#### Throws

Error if counts of vectors, documents, or IDs don't match

#### Overrides

`VectorStore.addVectors`

***

### delete()

> **delete**(`params?`): `Promise`\<`void`\>

Defined in: [s3-vectors.ts:423](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L423)

Delete vectors by ID, or delete the entire index when no IDs are given.

#### Parameters

##### params?

[`S3VectorsDeleteParams`](../interfaces/S3VectorsDeleteParams.md)

Optional deletion parameters

#### Returns

`Promise`\<`void`\>

#### Overrides

`VectorStore.delete`

***

### fromDocuments()

> `static` **fromDocuments**(`docs`, `embeddings`, `config`): `Promise`\<`AmazonS3Vectors`\>

Defined in: [s3-vectors.ts:563](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L563)

Static factory: create an AmazonS3Vectors instance and add
the given documents to the store.

#### Parameters

##### docs

`Document`\<`Record`\<`string`, `any`\>\>[]

##### embeddings

`EmbeddingsInterface`

##### config

[`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md) & `object`

#### Returns

`Promise`\<`AmazonS3Vectors`\>

#### Overrides

`VectorStore.fromDocuments`

***

### fromTexts()

> `static` **fromTexts**(`texts`, `metadatas`, `embeddings`, `config`): `Promise`\<`AmazonS3Vectors`\>

Defined in: [s3-vectors.ts:536](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L536)

Static factory: create an AmazonS3Vectors instance, embed
the given texts, and add them to the store.

#### Parameters

##### texts

`string`[]

##### metadatas

`Record`\<`string`, `unknown`\> \| `Record`\<`string`, `unknown`\>[]

##### embeddings

`EmbeddingsInterface`

##### config

[`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md) & `object`

#### Returns

`Promise`\<`AmazonS3Vectors`\>

#### Overrides

`VectorStore.fromTexts`

***

### getByIds()

> **getByIds**(`ids`, `options?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:471](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L471)

Retrieve documents by their vector IDs.

#### Parameters

##### ids

`string`[]

Array of vector IDs to retrieve

##### options?

Optional settings

###### batchSize?

`number`

Number of IDs per `GetVectors` call (default: 100)

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Array of documents in the same order as the input IDs

#### Remarks

The order of the returned documents matches the order of the input IDs.
When duplicate IDs are present, metadata is deep-copied (via `structuredClone`)
to prevent shared-reference mutations between returned documents.

#### Throws

Error if any ID is not found in the vector store

***

### similaritySearch()

> **similaritySearch**(`query`, `k?`, `filter?`, `_callbacks?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:366](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L366)

Run a text-based similarity search and return documents (no scores).

#### Parameters

##### query

`string`

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

##### \_callbacks?

`Callbacks`

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

#### Remarks

Overrides `VectorStore`'s default implementation, which embeds the
query with the indexing embedding model. This override routes through
[similaritySearchWithScore](#similaritysearchwithscore), so a configured `queryEmbeddings`
model is used for the query, matching `asRetriever()`'s behavior.

#### Overrides

`VectorStore.similaritySearch`

***

### similaritySearchByVector()

> **similaritySearchByVector**(`embedding`, `k?`, `filter?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:378](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L378)

Return documents most similar to a raw embedding vector (no scores).

#### Parameters

##### embedding

`number`[]

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

***

### similaritySearchVectorWithScore()

> **similaritySearchVectorWithScore**(`query`, `k`, `filter?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:314](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L314)

Core similarity search returning `[Document, distance]` tuples.

#### Parameters

##### query

`number`[]

Embedding vector to search against

##### k

`number`

Number of results to return

##### filter?

`Record`\<`string`, `unknown`\>

Optional metadata filter (S3 Vectors filter syntax)

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Array of `[Document, distance]` tuples, ordered by similarity

#### Remarks

This is the abstract method required by LangChain's `VectorStore`.
The score is the raw distance returned by S3 Vectors — lower means
more similar for both cosine and euclidean metrics.

#### Overrides

`VectorStore.similaritySearchVectorWithScore`

***

### similaritySearchWithRelevanceScores()

> **similaritySearchWithRelevanceScores**(`query`, `k?`, `filter?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:406](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L406)

Run a text-based similarity search and return documents with
*relevance scores* (higher is better), converted from S3 Vectors'
raw distance via [\_selectRelevanceScoreFn](#_selectrelevancescorefn).

#### Parameters

##### query

`string`

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

***

### similaritySearchWithScore()

> **similaritySearchWithScore**(`query`, `k?`, `filter?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:348](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/4d3f2a0a25b86c939212d8121d2ebf97a7a91fe5/src/s3-vectors.ts#L348)

Run a text-based similarity search and return documents with scores.

The query string is embedded using the query-embedding model, then
[similaritySearchVectorWithScore](#similaritysearchvectorwithscore) is called.

#### Parameters

##### query

`string`

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

#### Overrides

`VectorStore.similaritySearchWithScore`
