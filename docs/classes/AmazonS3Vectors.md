[**AWS LangChain S3 Vector TypeScript v0.6.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3Vectors

# Class: AmazonS3Vectors

Defined in: [s3-vectors.ts:145](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L145)

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

Defined in: [s3-vectors.ts:214](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L214)

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

Defined in: [s3-vectors.ts:157](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L157)

***

### dataType

> `readonly` **dataType**: `"float32"`

Defined in: [s3-vectors.ts:153](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L153)

***

### distanceMetric

> `readonly` **distanceMetric**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [s3-vectors.ts:154](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L154)

***

### FilterType

> **FilterType**: `Record`\<`string`, `unknown`\>

Defined in: [s3-vectors.ts:147](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L147)

**`Internal`**

discriminator used by LangChain

#### Overrides

`VectorStore.FilterType`

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [s3-vectors.ts:152](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L152)

***

### nonFilterableMetadataKeys

> `readonly` **nonFilterableMetadataKeys**: `string`[] \| `undefined`

Defined in: [s3-vectors.ts:155](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L155)

***

### pageContentMetadataKey

> `readonly` **pageContentMetadataKey**: `string` \| `null`

Defined in: [s3-vectors.ts:156](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L156)

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [s3-vectors.ts:151](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L151)

## Methods

### \_selectRelevanceScoreFn()

> **\_selectRelevanceScoreFn**(): (`distance`) => `number`

Defined in: [s3-vectors.ts:970](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L970)

**`Internal`**

Select the correct relevance-score function.

#### Returns

(`distance`) => `number`

***

### \_vectorstoreType()

> `abstract` **\_vectorstoreType**(): `string`

Defined in: [s3-vectors.ts:257](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L257)

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

Defined in: [s3-vectors.ts:377](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L377)

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

Custom IDs for each vector. When omitted, each
document's own `id` is used if it has one (e.g. a `Document` returned
by [getByIds](#getbyids), enabling a natural read-modify-write upsert); a
fresh UUID is generated only for documents with no `id` of their own.

###### signal?

`AbortSignal`

Abort an in-progress write. `embedDocuments`
itself can't be cancelled mid-call (LangChain's `EmbeddingsInterface`
has no signal support), so a batch already being embedded when the
signal fires still completes — but no further batch is embedded or put
afterward, and any `PutVectors` call already in flight is cancelled
mid-request.

#### Returns

`Promise`\<`string`[]\>

The IDs assigned to each stored vector

#### Remarks

Documents are embedded **per batch, one batch at a time** to keep peak
embedding-provider load low for large document sets (matching the
Python `langchain-aws` implementation) — `embedDocuments` is never
called concurrently for two batches, since most embedding providers
rate-limit aggressively and this library gives no retry/backoff
guarantee for that call. Once a batch is embedded, its `PutVectors`
call is dispatched without waiting for it to finish before embedding
the next batch, up to 10 `PutVectors` calls in flight at once — AWS's
own SDK already retries throttling there. Peak memory for in-flight
vectors is therefore bounded by roughly `10 × batchSize`, not
`batchSize` alone, in exchange for meaningfully higher write
throughput on large ingests.

#### Throws

Error if count of IDs doesn't match count of documents. On a
partial-write failure (a later batch fails after earlier ones already
committed), the thrown [S3VectorsError](S3VectorsError.md)'s `context.writtenIds`
lists every id that was durably written before the failure — check it
before retrying, especially for auto-generated ids, which would
otherwise be impossible to find or reconcile again.

#### Overrides

`VectorStore.addDocuments`

***

### addTexts()

> **addTexts**(`texts`, `metadatas?`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:509](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L509)

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

###### signal?

`AbortSignal`

Forwarded to [addDocuments](#adddocuments).

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

Defined in: [s3-vectors.ts:291](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L291)

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

Custom IDs for each vector. When omitted, each
document's own `id` is used if it has one (e.g. a `Document` returned
by [getByIds](#getbyids), enabling a natural read-modify-write upsert); a
fresh UUID is generated only for documents with no `id` of their own.

###### signal?

`AbortSignal`

Abort an in-progress write. Cancels the AWS SDK
request currently in flight and stops any further `PutVectors` calls
from starting; a batch's `PutVectors` call already in flight when the
signal fires is cancelled mid-request, not allowed to complete.

#### Returns

`Promise`\<`string`[]\>

The IDs assigned to each stored vector

#### Remarks

Vectors are batched in groups of 200 (default) and sent
via `PutVectorsCommand`. On the first call the index is auto-created
if it does not already exist and `createIndexIfNotExist` is `true`.

#### Throws

Error if counts of vectors, documents, or IDs don't match. On a
partial-write failure (a later batch fails after earlier ones already
committed), the thrown [S3VectorsError](S3VectorsError.md)'s `context.writtenIds`
lists every id that was durably written before the failure — check it
before retrying, especially for auto-generated ids, which would
otherwise be impossible to find or reconcile again.

#### Overrides

`VectorStore.addVectors`

***

### delete()

> **delete**(`params?`): `Promise`\<`void`\>

Defined in: [s3-vectors.ts:713](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L713)

Delete vectors by ID, or delete the entire index.

#### Parameters

##### params?

[`S3VectorsDeleteParams`](../interfaces/S3VectorsDeleteParams.md)

Deletion parameters

#### Returns

`Promise`\<`void`\>

#### Throws

Error if both `ids` and `deleteAll` are omitted — a safety guard against an
accidentally-`undefined` `ids` array silently wiping the whole index — or if both `ids`
and `deleteAll` are passed together. On a partial-delete failure (a
later batch fails after earlier ones already succeeded), the thrown
[S3VectorsError](S3VectorsError.md)'s `context.deletedIds` lists every id confirmed
deleted before the failure — deleting is idempotent, so a blind retry
of the full `ids` list is always safe regardless, but `deletedIds`
tells you exactly what already happened.

#### Overrides

`VectorStore.delete`

***

### fromDocuments()

> `static` **fromDocuments**(`docs`, `embeddings`, `config`): `Promise`\<`AmazonS3Vectors`\>

Defined in: [s3-vectors.ts:949](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L949)

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

#### Throws

If the write fails — including partway through a multi-batch
write — the thrown [S3VectorsError](S3VectorsError.md)'s `context.instance` carries
the constructed (and possibly partially-written) store, so the caller
can act on `context.writtenIds` without reconstructing an equivalent
instance from the same embeddings/config.

#### Overrides

`VectorStore.fromDocuments`

***

### fromTexts()

> `static` **fromTexts**(`texts`, `metadatas`, `embeddings`, `config`): `Promise`\<`AmazonS3Vectors`\>

Defined in: [s3-vectors.ts:911](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L911)

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

Defined in: [s3-vectors.ts:802](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L802)

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

###### signal?

`AbortSignal`

Abort an in-progress fetch. Cancels the
`GetVectors` calls currently in flight and stops any further batches
from starting.

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Array of documents in the same order as the input IDs

#### Remarks

The order of the returned documents matches the order of the input IDs.
When duplicate IDs are present, metadata is deep-copied (via `structuredClone`)
to prevent shared-reference mutations between returned documents.

#### Throws

Error if any ID is not found in the vector store, or if a
`GetVectors` batch call fails. Either way, the thrown
[S3VectorsError](S3VectorsError.md)'s `context.foundIds` lists every id already
confirmed found before the failure — including one found by a
concurrent batch that succeeded alongside the one that failed — so a
caller doesn't have to re-fetch everything from scratch.

***

### maxMarginalRelevanceSearch()

> **maxMarginalRelevanceSearch**(`_query`, `_options`, `_callbacks?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:676](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L676)

Maximal Marginal Relevance (MMR) search — **not supported** by this store.

#### Parameters

##### \_query

`string`

##### \_options

`MaxMarginalRelevanceSearchOptions`\<`Record`\<`string`, `unknown`\>\>

##### \_callbacks?

`Callbacks`

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

#### Remarks

`AmazonS3Vectors` intentionally does not implement real MMR, matching
the Python `langchain-aws` reference — use metadata pre-filtering or
client-side re-ranking if you need result diversity. Unlike Python's
`VectorStore.max_marginal_relevance_search` (a concrete base-class
method that raises `NotImplementedError` by default), `@langchain/core`'s
JS `VectorStore` only *types* this method as optional with no runtime
default — so this store defines it explicitly, purely to throw this
library's own coded [S3VectorsError](S3VectorsError.md) instead of a raw `TypeError`.

#### Throws

Always, with code `NOT_IMPLEMENTED`.

#### Overrides

`VectorStore.maxMarginalRelevanceSearch`

***

### similaritySearch()

> **similaritySearch**(`query`, `k?`, `filter?`, `_callbacks?`, `signal?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:605](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L605)

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

##### signal?

`AbortSignal`

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

> **similaritySearchByVector**(`embedding`, `k?`, `filter?`, `signal?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:622](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L622)

Return documents most similar to a raw embedding vector (no scores).

#### Parameters

##### embedding

`number`[]

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

##### signal?

`AbortSignal`

Abort an in-progress search (see [similaritySearchVectorWithScore](#similaritysearchvectorwithscore)).

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

***

### similaritySearchVectorWithScore()

> **similaritySearchVectorWithScore**(`query`, `k`, `filter?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:545](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L545)

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

##### signal?

`AbortSignal`

Abort an in-progress search. Cancels the `QueryVectors`
call currently in flight and stops any further pagination.

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

> **similaritySearchWithRelevanceScores**(`query`, `k?`, `filter?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:650](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L650)

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

##### signal?

`AbortSignal`

Abort an in-progress search (see [similaritySearchVectorWithScore](#similaritysearchvectorwithscore)).

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

***

### similaritySearchWithScore()

> **similaritySearchWithScore**(`query`, `k?`, `filter?`, `_callbacks?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:581](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c3fc682992dafcc76e8f94def4d36a91007797fb/src/s3-vectors.ts#L581)

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

##### \_callbacks?

`Callbacks`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

#### Remarks

Validates `k` before embedding — an invalid `k` shouldn't cost a
billable `embedQuery` call before failing.

#### Overrides

`VectorStore.similaritySearchWithScore`
