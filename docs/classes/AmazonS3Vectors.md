[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3Vectors

# Class: AmazonS3Vectors

Defined in: [s3-vectors.ts:92](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L92)

LangChain vector store backed by **Amazon S3 Vectors**.

Provides persistent vector storage, similarity search, and metadata filtering
using the native AWS S3 Vectors service.

## Remarks

Requires an existing S3 vector bucket (created manually via the AWS
console or CLI). The vector index inside the bucket is created
automatically on the first write when [AmazonS3VectorsConfig.createIndexIfNotExist](../interfaces/AmazonS3VectorsConfig.md#createindexifnotexist)
is `true` (the default).

Documents are embedded per batch to keep peak memory usage low for
large document sets.

Throttling and transient (5xx) failures are retried automatically by the
AWS SDK; tune this via the `maxAttempts` and `retryMode` config options.

Maximal Marginal Relevance (`maxMarginalRelevanceSearch`) is implemented:
candidates come from `QueryVectors`, their embeddings from `GetVectors`, and
the selection from `@langchain/core`'s own `maximalMarginalRelevance`.

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

Defined in: [s3-vectors.ts:182](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L182)

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

A store bound to one index. Constructing it issues **no AWS
request**: the index is checked, and created, on the first write that
needs it.

#### Throws

`VALIDATION` for any option outside its
documented set or shape — a bucket or index name that breaks AWS's naming
rules, a `distanceMetric`, `dataType` or `sseType` outside the SDK's own
enum, a `pageContentMetadataKey` that is neither `null` nor 1–63
characters, a non-array `nonFilterableMetadataKeys`, a non-function
`relevanceScoreFn`, malformed `tags`, a non-positive
`maxConcurrentBatchCalls`, a `client` that is not an `S3VectorsClient`, or
a `client` supplied alongside `region`, `credentials`, `endpoint`,
`maxAttempts` or `retryMode`, which it would silently override.

#### Overrides

`VectorStore.constructor`

## Properties

### createIndexIfNotExist

> `readonly` **createIndexIfNotExist**: `boolean`

Defined in: [s3-vectors.ts:120](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L120)

***

### dataType

> `readonly` **dataType**: `"float32"`

Defined in: [s3-vectors.ts:116](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L116)

***

### distanceMetric

> `readonly` **distanceMetric**: [`DistanceMetric`](../type-aliases/DistanceMetric.md)

Defined in: [s3-vectors.ts:117](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L117)

***

### encryptionConfiguration

> `readonly` **encryptionConfiguration**: `EncryptionConfiguration` \| `undefined`

Defined in: [s3-vectors.ts:121](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L121)

***

### FilterType

> **FilterType**: `Record`\<`string`, `unknown`\>

Defined in: [s3-vectors.ts:99](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L99)

The metadata-filter shape accepted by every search method (S3 Vectors'
native filter syntax, e.g. `{ genre: "scifi" }` or `{ $and: [...] }`).
This is the type LangChain's `VectorStore` reads via `this['FilterType']`
— a public part of the contract, not an implementation detail.

#### Overrides

`VectorStore.FilterType`

***

### indexName

> `readonly` **indexName**: `string`

Defined in: [s3-vectors.ts:115](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L115)

***

### lc\_serializable

> **lc\_serializable**: `boolean` = `false`

Defined in: [s3-vectors.ts:110](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L110)

Pinned here rather than left to `@langchain/core`'s default.
[S3VectorsErrorContext.instance](../interfaces/S3VectorsErrorContext.md#instance) hands a live store handle to
callers, and `Serializable#toJSON()` renders it as a harmless
type-identifier stub — instead of dumping instance fields, `_client`
and its credentials included — only while this is `false`. Declaring
it explicitly keeps that true even if the upstream default ever
changes; a regression test asserts no client internals serialize.

#### Overrides

`VectorStore.lc_serializable`

***

### maxConcurrentBatchCalls

> `readonly` **maxConcurrentBatchCalls**: `number`

Defined in: [s3-vectors.ts:123](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L123)

***

### nonFilterableMetadataKeys

> `readonly` **nonFilterableMetadataKeys**: `string`[] \| `undefined`

Defined in: [s3-vectors.ts:118](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L118)

***

### pageContentMetadataKey

> `readonly` **pageContentMetadataKey**: `string` \| `null`

Defined in: [s3-vectors.ts:119](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L119)

***

### tags

> `readonly` **tags**: `Record`\<`string`, `string`\> \| `undefined`

Defined in: [s3-vectors.ts:122](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L122)

***

### vectorBucketName

> `readonly` **vectorBucketName**: `string`

Defined in: [s3-vectors.ts:114](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L114)

## Methods

### \_selectRelevanceScoreFn()

> **\_selectRelevanceScoreFn**(): (`distance`) => `number`

Defined in: [s3-vectors.ts:917](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L917)

**`Internal`**

The distance-to-relevance conversion this store uses.

 Called by `@langchain/core`'s
`similaritySearchWithRelevanceScores`, not by application code.

#### Returns

The configured `relevanceScoreFn`, else `cosineRelevanceScoreFn`
for a cosine index

(`distance`) => `number`

#### Throws

`VALIDATION` for a euclidean index with no
`relevanceScoreFn`: euclidean distance is unbounded above, so there is no
correct fixed conversion to fall back to.

***

### \_vectorstoreType()

> **\_vectorstoreType**(): `string`

Defined in: [s3-vectors.ts:281](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L281)

The store type `@langchain/core` records on traces and retriever tags.

#### Returns

`string`

`'amazonS3Vectors'`, stable for `1.x`

#### Throws

Nothing.

#### Overrides

`VectorStore._vectorstoreType`

***

### addDocuments()

> **addDocuments**(`documents`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:386](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L386)

Embed documents and store them in the vector index.

#### Parameters

##### documents

`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]

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
embedding-provider load low for large document sets —
`embedDocuments` is never
called concurrently for two batches, since most embedding providers
rate-limit aggressively and this library gives no retry/backoff
guarantee for that call. Embedding and writing are **pipelined**: once
a batch is embedded, its `PutVectors` call is dispatched and the next
batch is embedded immediately, without waiting for that put to finish.
At most [maxConcurrentBatchCalls](#maxconcurrentbatchcalls) (default 10) `PutVectors`
calls are in flight at once; when that window is full, embedding
pauses until one of them settles. AWS's own SDK already retries
throttling on the put side. Peak memory for in-flight vectors is
therefore bounded by roughly `(maxConcurrentBatchCalls + 1) × batchSize`
vectors, in exchange for meaningfully higher write throughput on
large ingests than a strict embed-then-put loop.

The very first batch is the exception: it is embedded and written
alone, and awaited, before anything else starts — it is the one that
creates or validates the index, and every later batch depends on that
having happened.

#### Throws

Error if count of IDs doesn't match count of documents, or if
any id (supplied or taken from a document) is not a non-empty string
or appears more than once in the same call. On a partial-write failure
(a later batch fails after earlier ones already committed), the thrown
[S3VectorsError](S3VectorsError.md)'s `context.writtenIds` lists every id that was
durably written before the failure — check it before retrying,
especially for auto-generated ids, which would otherwise be impossible
to find or reconcile again. A failure stops further batches from being
embedded or written; the error is thrown only after every `PutVectors`
call already in flight has settled, so `writtenIds` is complete.

#### Overrides

`VectorStore.addDocuments`

***

### addVectors()

> **addVectors**(`vectors`, `documents`, `options?`): `Promise`\<`string`[]\>

Defined in: [s3-vectors.ts:319](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L319)

Add pre-computed vectors alongside their documents to the store.

#### Parameters

##### vectors

`number`[][]

Array of embedding vectors (one per document)

##### documents

`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]

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

Error if counts of vectors, documents, or IDs don't match, or
if any id (supplied or taken from a document) is not a non-empty
string or appears more than once in the same call — S3 Vectors keys
must be non-empty, and a duplicate key inside one call would silently
overwrite an earlier vector with a later one. On a partial-write
failure (a later batch fails after earlier ones already committed),
the thrown [S3VectorsError](S3VectorsError.md)'s `context.writtenIds` lists every
id that was durably written before the failure — check it before
retrying, especially for auto-generated ids, which would otherwise be
impossible to find or reconcile again.

#### Overrides

`VectorStore.addVectors`

***

### asRetriever()

> **asRetriever**(`kOrFields?`, `filter?`, `callbacks?`, `tags?`, `metadata?`, `verbose?`): [`AmazonS3VectorsRetriever`](AmazonS3VectorsRetriever.md)\<`AmazonS3Vectors`\>

Defined in: [s3-vectors.ts:814](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L814)

Build a retriever over this store.

#### Parameters

##### kOrFields?

`number` \| [`AmazonS3VectorsRetrieverFields`](../interfaces/AmazonS3VectorsRetrieverFields.md)\<`AmazonS3Vectors`\>

Documents to retrieve, or a fields object
(`k`, `filter`, `searchType`, `searchKwargs`, `signal`, `tags`,
`metadata`, `verbose`, `callbacks`)

##### filter?

`Record`\<`string`, `unknown`\>

Metadata filter, for the numeric form

##### callbacks?

`Callbacks`

Callbacks, for the numeric form

##### tags?

`string`[]

Run tags, for the numeric form. This store's type is
appended to whatever is given, as core does

##### metadata?

`Record`\<`string`, `unknown`\>

Run metadata, for the numeric form

##### verbose?

`boolean`

Verbose logging, for the numeric form

#### Returns

[`AmazonS3VectorsRetriever`](AmazonS3VectorsRetriever.md)\<`AmazonS3Vectors`\>

A retriever bound to this store

#### Remarks

Returns an [AmazonS3VectorsRetriever](AmazonS3VectorsRetriever.md) — core's `VectorStoreRetriever`
plus a `signal` field. Everything core documents works unchanged, the
numeric `asRetriever(4)` form included.

**Which signal does what.** A signal passed here, as a retriever field,
reaches `QueryVectors` and `GetVectors` and cancels the AWS request. A
signal passed to `invoke(query, { signal })` ends that invocation only:
core's `BaseRetriever.invoke` never hands the config to
`_getRelevantDocuments` (`@langchain/core@1.2.9`
`dist/retrievers/index.js:81`, `:85`), so no subclass can route it to the
request. Both may be given at once.

#### Throws

Nothing. Building a retriever issues no request and validates
nothing: its `k` and `filter` are checked when it runs a search, by the
same guards a direct call goes through.

#### Overrides

`VectorStore.asRetriever`

***

### delete()

> **delete**(`params?`): `Promise`\<`void`\>

Defined in: [s3-vectors.ts:651](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L651)

Delete vectors by ID, or delete the entire index.

#### Parameters

##### params?

[`S3VectorsDeleteParams`](../interfaces/S3VectorsDeleteParams.md)

Deletion parameters

#### Returns

`Promise`\<`void`\>

Nothing. A delete reports what it removed only when it fails
partway, via `context.deletedIds`; a complete one removed everything
asked for, including ids that were not there to begin with.

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

Defined in: [s3-vectors.ts:885](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L885)

Create a store and add the given documents to it.

#### Parameters

##### docs

`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]

The documents to store

##### embeddings

`EmbeddingsInterface`

The model used to embed them

##### config

[`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md) & `object`

The store configuration, plus the `ids`, `batchSize` and
`signal` the write takes

#### Returns

`Promise`\<`AmazonS3Vectors`\>

The constructed store, after the write

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

Defined in: [s3-vectors.ts:840](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L840)

Create a store, embed the given texts and add them to it.

#### Parameters

##### texts

`string`[]

The texts to store, one document each

##### metadatas

`Record`\<`string`, `unknown`\> \| `Record`\<`string`, `unknown`\>[]

One object per text, a single object broadcast to every
text, or omitted entirely — which gives each document `{}`

##### embeddings

`EmbeddingsInterface`

The model used to embed them

##### config

[`AmazonS3VectorsConfig`](../interfaces/AmazonS3VectorsConfig.md) & `object`

The store configuration, plus the `ids`, `batchSize` and
`signal` the write takes

#### Returns

`Promise`\<`AmazonS3Vectors`\>

The constructed store, after the write

#### Throws

`VALIDATION` when `texts` is not an array or the
metadata array's length disagrees with it; otherwise whatever
[fromDocuments](#fromdocuments) raises, including the constructed instance on
`context.instance`.

#### Overrides

`VectorStore.fromTexts`

***

### getByIds()

> **getByIds**(`ids`, `options?`): `Promise`\<(`Document`\<`Record`\<`string`, `any`\>\> \| `undefined`)[]\>

Defined in: [s3-vectors.ts:694](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L694)

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

`Promise`\<(`Document`\<`Record`\<`string`, `any`\>\> \| `undefined`)[]\>

Array of documents in the same order as the input IDs

#### Remarks

The order of the returned documents matches the order of the input IDs.
When duplicate IDs are present, metadata is deep-copied (via `structuredClone`)
to prevent shared-reference mutations between returned documents.

**A missing id yields `undefined` in its slot**, never a shorter array.
`GetVectors` returns neither an entry nor an error for a key that is not
there (`docs/evidence/get-vectors-absent-keys.md`), so absence is an
ordinary answer and the result stays aligned with the id list — the
caller reads `result[i]` for `ids[i]` without tracking which ones
survived. This is the `@langchain/core` `VectorStore.getByIds`
contract's `(Document | undefined)[]` and not a stricter one.

#### Throws

Error if any ID is not found in the vector store, or if a
`GetVectors` batch call fails. Either way, the thrown
[S3VectorsError](S3VectorsError.md)'s `context.foundIds` lists every id already
confirmed found before the failure — including one found by a
concurrent batch that succeeded alongside the one that failed — so a
caller doesn't have to re-fetch everything from scratch.

***

### listDocuments()

> **listDocuments**(`options?`): `AsyncGenerator`\<`Document`\<`Record`\<`string`, `any`\>\>\>

Defined in: [s3-vectors.ts:738](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L738)

Every document in the index, one at a time.

#### Parameters

##### options?

[`S3VectorsListParams`](../interfaces/S3VectorsListParams.md)

Optional settings

#### Returns

`AsyncGenerator`\<`Document`\<`Record`\<`string`, `any`\>\>\>

An async generator of documents, mapped exactly as
[getByIds](#getbyids) maps them.

#### Remarks

`ListVectors` takes no filter and promises no order, so this is an audit
and export primitive, not a query one — use [similaritySearch](#similaritysearch) to
find documents. It is an async generator, so memory stays bounded by one
page however large the index, and breaking out of the loop issues no
further request.

Requires **`s3vectors:ListVectors` and `s3vectors:GetVectors`**: the
listing asks for metadata, and AWS answers a metadata or data request made
without `s3vectors:GetVectors` with `403 Forbidden`.

#### Throws

`VALIDATION` for `pageSize`, before any request;
`ABORTED`; `ACCESS_DENIED` naming the missing permission; otherwise the
class the failure maps to, carrying `pagesScanned` and the number already
yielded — items already yielded have been consumed, so a listing is not
atomic and does not pretend to be.

***

### listVectors()

> **listVectors**(`options?`): `AsyncGenerator`\<[`S3VectorsRecord`](../interfaces/S3VectorsRecord.md)\>

Defined in: [s3-vectors.ts:773](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L773)

Every vector in the index with its embedding, one at a time.

#### Parameters

##### options?

[`S3VectorsListParams`](../interfaces/S3VectorsListParams.md)

Optional settings, as [listDocuments](#listdocuments) takes them

#### Returns

`AsyncGenerator`\<[`S3VectorsRecord`](../interfaces/S3VectorsRecord.md)\>

An async generator of `{ id, vector, document }`

#### Remarks

The migration primitive. An index's `dimension` and `distanceMetric` are
fixed at creation, so changing either means copying every record into a
new index; this yields exactly what [addVectors](#addvectors) takes back.

Costs an order of magnitude more round trips than [listDocuments](#listdocuments):
the 1 MB page cap is reached at roughly 40 vectors of 1,536 dimensions,
against the 500-row default a metadata-only page reaches comfortably. Two
methods rather than one flag, so that difference is visible at the call
site.

Requires the same two permissions as [listDocuments](#listdocuments).

#### Throws

What [listDocuments](#listdocuments) throws, plus
`AWS_INVALID_RESPONSE` if a record arrives without data despite this call
requesting it — a record whose embedding is missing is not skipped,
because a migration that dropped records silently would produce a target
index that looks complete and is not.

***

### maxMarginalRelevanceSearch()

> **maxMarginalRelevanceSearch**(`query`, `options`, `callbacks?`, `signal?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:586](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L586)

Maximal Marginal Relevance search: relevance traded against diversity.

Accepts:
- `options.k` — documents to return (default 4).
- `options.fetchK` — candidates considered before selecting (default 20).
  Below `k` is not an error: at most that many candidates exist.
- `options.lambda` — 0 to 1 inclusive, 0 favouring diversity entirely and
  1 relevance entirely (default 0.5).
- `callbacks` — core's `Callbacks` slot, accepted and ignored. A signal
  here is rejected; it belongs in the fourth argument.
- `signal` — a fourth parameter this package adds. Core declares three
  (`@langchain/core@1.2.9` `dist/vectorstores.d.ts:528`) and passes no
  config to `_getRelevantDocuments`, so a retriever-scoped signal has no
  other route to the underlying requests. Absent behaves exactly as core's
  three-parameter call.

#### Parameters

##### query

`string`

##### options

`MaxMarginalRelevanceSearchOptions`\<`Record`\<`string`, `unknown`\>\>

##### callbacks?

`Callbacks`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

At most `k` documents, most relevant first, each distinct. Fewer
than `k` when the index holds fewer candidates than asked for.

#### Throws

`VALIDATION` for `k`, `fetchK` or `lambda`, before
the billable `embedQuery`; otherwise whatever the search and fetch raise.

#### Overrides

`VectorStore.maxMarginalRelevanceSearch`

***

### similaritySearch()

> **similaritySearch**(`query`, `k?`, `filter?`, `_callbacks?`, `signal?`): `Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [s3-vectors.ts:509](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L509)

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

Accepted and ignored, per `@langchain/core`'s
`VectorStore` signature. Passing an `AbortSignal` here throws a coded
`VALIDATION` error rather than silently running the search uncancelled —
the signal belongs in the fifth argument.

##### signal?

`AbortSignal`

Abort an in-progress search (see [similaritySearchVectorWithScore](#similaritysearchvectorwithscore)).

#### Returns

`Promise`\<`Document`\<`Record`\<`string`, `any`\>\>[]\>

The documents, nearest first, at most `k` of them.

#### Remarks

Overrides `VectorStore`'s default implementation, which embeds the
query with the indexing embedding model. This override routes through
[similaritySearchWithScore](#similaritysearchwithscore), so a configured `queryEmbeddings`
model is used for the query, matching `asRetriever()`'s behavior.

#### Throws

Whatever [similaritySearchWithScore](#similaritysearchwithscore)
raises; this adds no failure of its own beyond rejecting a signal in the
callbacks slot.

#### Overrides

`VectorStore.similaritySearch`

***

### similaritySearchVectorWithScore()

> **similaritySearchVectorWithScore**(`query`, `k`, `filter?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:421](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L421)

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

#### Throws

A coded `AWS_INVALID_RESPONSE` error if a result is missing its
`distance` — this always requests `returnDistance: true`, so a missing
value means a malformed response rather than a legitimately scoreless
result. Fails closed instead of defaulting to the best possible score.

#### Overrides

`VectorStore.similaritySearchVectorWithScore`

***

### similaritySearchWithRelevanceScores()

> **similaritySearchWithRelevanceScores**(`query`, `k?`, `filter?`, `callbacks?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:551](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L551)

Run a text-based similarity search and return documents with
*relevance scores* (higher is better), converted from S3 Vectors'
raw distance via [AmazonS3VectorsConfig.relevanceScoreFn](../interfaces/AmazonS3VectorsConfig.md#relevancescorefn) when
configured, otherwise `cosineRelevanceScoreFn` — which is the exact
inverse of what a cosine index returns. A **euclidean** index has no
built-in conversion and raises `VALIDATION` here unless
`relevanceScoreFn` is configured: euclidean distance is unbounded above,
so no fixed formula maps it to a comparable score without knowing the
embedding's scale.

#### Parameters

##### query

`string`

##### k?

`number` = `4`

##### filter?

`Record`\<`string`, `unknown`\>

##### callbacks?

`Callbacks`

The `Callbacks` slot every text-based method on this
class reserves in this position, accepted and ignored exactly as in
[similaritySearch](#similaritysearch) and [similaritySearchWithScore](#similaritysearchwithscore). An
`AbortSignal` passed here is rejected with a coded `VALIDATION` error
before the billable `embedQuery` call, as on those siblings. (Through
0.x this method honored a signal in this position, where earlier
versions expected it; 1.0 aligned it with the rest of the class.)

##### signal?

`AbortSignal`

Abort an in-progress search (see [similaritySearchVectorWithScore](#similaritysearchvectorwithscore)).

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

`[document, score]` pairs, most relevant first, at most `k` of
them. Higher is better, which is the opposite direction from the raw
distance [similaritySearchWithScore](#similaritysearchwithscore) returns.

#### Throws

`VALIDATION` on a euclidean index with no
`relevanceScoreFn` — there is no correct conversion to fall back to;
otherwise whatever [similaritySearchWithScore](#similaritysearchwithscore) raises.

***

### similaritySearchWithScore()

> **similaritySearchWithScore**(`query`, `k?`, `filter?`, `_callbacks?`, `signal?`): `Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

Defined in: [s3-vectors.ts:464](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/s3-vectors.ts#L464)

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

Accepted and ignored, per `@langchain/core`'s
`VectorStore` signature. Passing an `AbortSignal` here throws a coded
`VALIDATION` error rather than silently running the search uncancelled —
the signal belongs in the fifth argument.

##### signal?

`AbortSignal`

Abort an in-progress search (see [similaritySearchVectorWithScore](#similaritysearchvectorwithscore)).

#### Returns

`Promise`\<\[`Document`\<`Record`\<`string`, `any`\>\>, `number`\][]\>

`[document, distance]` pairs, nearest first, at most `k` of them.
Fewer than `k` is normal for a filtered search over a sparse index.

#### Remarks

Validates `k` before embedding — an invalid `k` shouldn't cost a
billable `embedQuery` call before failing.

#### Throws

`EMBEDDINGS_MISSING` when no query-side model is
configured; `VALIDATION` for `k`, the filter, or a signal in the
callbacks slot — all before the billable `embedQuery`; otherwise whatever
[similaritySearchVectorWithScore](#similaritysearchvectorwithscore) raises.

#### Overrides

`VectorStore.similaritySearchWithScore`
