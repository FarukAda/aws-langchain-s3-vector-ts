# Amazon S3 Vectors — LangChain Integration Guide

> Architecture, concepts, and advanced patterns for the `@farukada/aws-langchain-s3-vector-ts` library.

---

## How It Works

This library bridges two systems:

1. **LangChain.js** — the AI/ML orchestration framework (`VectorStore` base class)
2. **Amazon S3 Vectors** — a purpose-built AWS service for vector storage and similarity search

The `AmazonS3Vectors` class extends LangChain's `VectorStore`, implementing all required abstract methods while adding S3 Vectors–specific features like auto-provisioning, per-batch embedding, and metadata filtering.

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│ Your Application │────▶│  AmazonS3Vectors │────▶│   Amazon S3 Vectors  │
│                 │     │  (this library)  │     │  (AWS service)       │
│  ● addDocuments │     │  ● Batching      │     │  ● Vector Bucket     │
│  ● search       │     │  ● Embedding     │     │    └─ Vector Index   │
│  ● asRetriever  │     │  ● Metadata      │     │       ├─ PutVectors  │
└─────────────────┘     └──────────────────┘     │       ├─ QueryVectors│
                               │                 │       └─ GetVectors  │
                        ┌──────┘                  └──────────────────────┘
                        ▼
                ┌───────────────┐
                │  Embeddings   │
                │  (any model)  │
                └───────────────┘
```

## Core Concepts

### Vector Buckets and Indexes

S3 Vectors organises data in a two-level hierarchy:

- **Vector Bucket** — a container you create manually (via AWS CLI or console)
- **Vector Index** — created inside a bucket, defines dimension, data type, and distance metric

The library auto-creates the vector index on the first write if `createIndexIfNotExist` is `true` (the default). It detects the correct dimension from your first batch of vectors/documents.

### Document ↔ Vector Mapping

When you call `addDocuments()`, the documents go through this pipeline:

1. **Validation and metadata assembly** — for the whole input, before anything is spent: every id is checked, and each document's `doc.metadata` is merged with `{ _page_content: doc.pageContent }` and checked against S3 Vectors' rules
2. **Embedding** — per batch, the configured `EmbeddingsInterface` produces vectors, which are checked as they come back
3. **Storage** — each batch's vectors and metadata are sent to S3 Vectors via `PutVectorsCommand`

When reading documents back (via search or `getByIds`), the process reverses: `_page_content` is extracted from metadata and restored as `doc.pageContent`, then removed from the metadata object.

The key is removed only when it actually held a string. A non-string value under that key was never written by this library, so it belongs to whatever else shares the index — `pageContent` stays empty and the raw value is left in `metadata` rather than being silently dropped.

### The `_page_content` Key

S3 Vectors stores vectors with optional metadata but does not have a native "text" field. The library works around this by storing the document's page content inside the metadata map under the `_page_content` key.

You can customise this:
- **Different key:** `{ pageContentMetadataKey: "text" }` — stores under `"text"` instead
- **Disable entirely:** `{ pageContentMetadataKey: null }` — page content is embedded but not stored (retrieved documents will have empty `pageContent`)

## Per-Batch Embedding

Unlike a naive approach that embeds all documents at once (which can exhaust memory for large datasets), this library embeds documents **per batch**:

```typescript
// With 10,000 documents and batchSize: 200 (default):
// → 50 embedding calls, each processing 200 texts
// → 50 PutVectors calls, each storing 200 vectors
// → Peak memory: a bounded window of batches, not all 10,000
await store.addDocuments(largeDocs, { batchSize: 200 });
```

`embedDocuments` is never called for two batches at once, but a batch's `PutVectors` is dispatched while the next batch is embedded, so up to `maxConcurrentBatchCalls` (default 10) writes are in flight. Peak memory for in-flight vectors is therefore bounded by roughly `(maxConcurrentBatchCalls + 1) × batchSize` — by the two knobs, never by the size of the input, which is what makes a large ingest survivable. Before the first batch is embedded, every document's id and metadata are checked, so an input that cannot be stored is refused without an embedding call; each batch's vectors are checked as the model returns them.

## Similarity Search

The library supports five search methods:

| Method | Input | Returns |
|---|---|---|
| `similaritySearch(query, k?, filter?, callbacks?, signal?)` | Text string | `Document[]` |
| `similaritySearchWithScore(query, k?, filter?, callbacks?, signal?)` | Text string | `[Document, distance][]` |
| `similaritySearchWithRelevanceScores(query, k?, filter?, callbacks?, signal?)` | Text string | `[Document, score][]` |
| `similaritySearchVectorWithScore(vector, k, filter?, signal?)` | Raw vector | `[Document, distance][]` |
| `maxMarginalRelevanceSearch(query, { k, fetchK, lambda }, callbacks?, signal?)` | Text string | `Document[]` |

The text-based methods reserve a `Callbacks` slot (accepted and ignored) so they line up with LangChain’s own signatures; the vector-based one takes the `AbortSignal` one position earlier, since it has no callbacks slot. The query is checked to be a string, `k` and the filter are validated, and the signal is checked, *before* the query is embedded; the embedded query vector is then held to the rules a stored vector is, before any request — an invalid argument or an already-aborted signal never costs a billable `embedQuery` call.

Passing an `AbortSignal` in that `Callbacks` slot raises a coded `VALIDATION` error on all three text-based searches rather than being silently ignored: the search would otherwise run to completion, uncancelled, after already spending a billable `embedQuery` call. Pass it as the fifth argument instead.

**Distance vs. relevance:** S3 Vectors returns a *distance* (lower = more similar). LangChain expects a *relevance score* (higher = more relevant). One conversion is built in, and only one:

- **Cosine:** `cosineRelevanceScoreFn` — `1.0 - distance`. Cosine distance is exactly `1 − cosine_similarity` (`docs/evidence/cosine-distance.md`), so the score range is `[-1, 1]`, and `[0, 1]` for the normalised embeddings most models produce.
- **Euclidean:** none. `similaritySearchWithRelevanceScores` on a euclidean index with no `relevanceScoreFn` raises `VALIDATION` rather than returning a number: euclidean distance is unbounded above, so no fixed formula maps it to a comparable score without knowing your embedding's scale. Supply `relevanceScoreFn` in the config, or read raw distances with `similaritySearchWithScore`.

Call `similaritySearchWithRelevanceScores(query, k, filter?, callbacks?, signal?)` to get `[Document, score][]` tuples with the conversion already applied. Through 0.x this method also honored an `AbortSignal` in the fourth position, where earlier versions expected it; since 1.0 it takes the signal fifth like its siblings, and a signal in the fourth slot is rejected the same way.

## Advanced Patterns

### Separate Query Embeddings

Some embedding providers use different models for documents vs. queries (e.g., asymmetric search). The library supports this via `queryEmbeddings`:

```typescript
const store = new AmazonS3Vectors(documentEmbeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  queryEmbeddings: querySpecificEmbeddings,
});
```

### Non-Filterable Metadata Keys

S3 Vectors allows you to mark certain metadata keys as non-filterable. These keys are stored and returned but cannot be used in query filters. Useful for large blobs that would be expensive to index:

```typescript
const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  nonFilterableMetadataKeys: ["full_text", "raw_html"],
});
```

This is set at index creation time and **cannot be changed after the index exists**.

### Metadata Filtering

Pass a filter object to any search method to narrow results by metadata:

```typescript
const results = await store.similaritySearch("adventure", 4, {
  genre: { "$eq": "scifi" },
});
```

The filter syntax follows the S3 Vectors native filter format.

### Bring Your Own Client

For advanced AWS configurations (custom credentials, endpoints, middleware), you can provide a pre-built `S3VectorsClient`:

```typescript
import { S3VectorsClient } from "@aws-sdk/client-s3vectors";

const client = new S3VectorsClient({
  region: "eu-west-1",
  credentials: myCredentialProvider,
  maxAttempts: 5,
});

const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  client, // exclusive with region/credentials/endpoint/maxAttempts/retryMode/the three timeouts
});
```

The client is identified by its `config.serviceId`, not by `instanceof` — so a bundler that duplicates `@aws-sdk/client-s3vectors` across a module boundary, and a legitimate subclass such as a tracing wrapper, both still work. A value that is not an `S3VectorsClient` is rejected with a coded `VALIDATION` error rather than silently replaced: the replacement would be built from the ambient credential chain and default region, which could point the store at a different AWS account. Passing `client: null` or `undefined` simply means "not provided", and the store builds its own from `region`/`credentials`/`endpoint`.

## Error Handling

Every failure this library surfaces — caller mistake, not-found, malformed AWS response, or an underlying AWS error — is a single typed `S3VectorsError` carrying a stable `code`, a `context`, and the original `cause`. No raw AWS SDK error and no bare `TypeError` reaches the caller. Detect it with the exported `isS3VectorsError()` type guard.

| Code | Raised when |
|---|---|
| `VALIDATION` | Caller input was invalid — a mismatched count, a non-array argument, an options bag that is not an object, a bad batch size or page size, a malformed filter, a reserved metadata key, an empty-string or duplicate vector id within one write call, a configuration option outside its documented set, or a `client` supplied alongside an option that would configure one. Raised before any AWS call, and before any billable embedding. |
| `AWS_REJECTED` | `ValidationException` (400): AWS refused the request. `context.fieldList` carries its field-level detail. |
| `THROTTLED` | `TooManyRequestsException` (429). Retry after a backoff. |
| `SERVICE_UNAVAILABLE` | `InternalServerException` (500), `ServiceUnavailableException` (503) or `RequestTimeoutException` (408). A 503 from `PutVectors` also means the batch exceeded resource capacity — `context.batchSize` says how large it was, so you can split rather than retry. |
| `ACCESS_DENIED` | `AccessDeniedException` (403). An IAM problem, not a retryable one. |
| `QUOTA_EXCEEDED` | `ServiceQuotaExceededException` (402). Needs a quota increase. |
| `CONFLICT` | `ConflictException` (409) from `CreateIndex`: the index already exists. |
| `KMS_ERROR` | One of the four KMS exceptions (400). Key state — an operator's problem. |
| `NOT_FOUND` | `NotFoundException` (404): the bucket or index is not there. A missing *vector id* is not this — `getByIds` returns `undefined` in that id's slot. |
| `EMBEDDINGS_MISSING` | An operation needed an embedding model but none was configured. |
| `AWS_REQUEST_FAILED` | An AWS request failed and no narrower class applies. |
| `INDEX_CONFIG_MISMATCH` | An existing index disagrees with this store's configuration: its distance metric, checked against the `QueryVectors` response on every read, or its non-filterable metadata keys, checked against the `GetIndex` that precedes a first write. Also raised when the vectors in one batch disagree with each other on dimension. |
| `ABORTED` | The supplied `AbortSignal` fired before or during the operation. |
| `AWS_INVALID_RESPONSE` | An AWS response was missing, carried an unusable value for, or wasn't an object at all where this library requires one. Reachable only from a mocked, stubbed or otherwise non-conforming client. |
| `QUERY_PAGE_LIMIT_EXCEEDED` | A paginated search hit the 1,000-page runaway ceiling with pages still outstanding and fewer than `k` results collected. |
| `UNEXPECTED_ERROR` | A failure that never touched AWS — a raw throw from a caller-supplied embeddings model, or input malformed enough to bypass validation. |

`NotFoundException` is still caught and treated as an expected outcome in the places where absence is the normal case: index detection during a write, and `deleteIndex()` against an index that is already gone.

The library fails closed rather than guessing. A query result missing a usable numeric `distance`, a response whose `distanceMetric` cannot be recognised, a response that is not an object at all, a vector returned without data when data was requested, and a paginated search that hits the page ceiling short of `k` all raise a coded error instead of returning a plausible-looking but wrong result.

Pagination ends on the token, never on page size. AWS documents a `QueryVectors` page as *up to* 100 results and a `ListVectors` page as capped at 1 MB of processed data, so a short page is normal and is not the end of the results — only an absent `nextToken` is. A runaway ceiling of 1,000 pages bounds the worst case. AWS pagination tokens are valid for only a few minutes, so a failure partway through a long paginated search reports which page it was on and suggests re-issuing the original query rather than resuming it.

On a partial multi-batch failure, the thrown error carries what already succeeded: `context.writtenIds` for writes, `context.attemptedIds` for the full resolved id list (retry with `{ ids: attemptedIds }` to overwrite in place instead of minting fresh UUIDs), `context.deletedIds` for deletes, and `context.foundIds` for `getByIds`. This matters most for auto-generated ids, which nothing else records.

The AWS SDK v3 has built-in retry behaviour (exponential backoff with jitter) for throttling and transient 5xx failures. Configure it with `maxAttempts`/`retryMode`, or on a `S3VectorsClient` you pass in yourself.

## Deletion

Removing vectors and destroying an index are two different methods, deliberately:

- **By IDs:** `await store.delete({ ids: ["id1", "id2"] })` — deletes specific vectors (batched, default 500 per call). `ids` is required, and `delete` will not destroy an index whatever it is passed.
- **Entire index:** `await store.deleteIndex()` — deletes the whole vector index (not the bucket). It has to be named to be called, precisely because destroying a resource is not what `delete` means.

Both are idempotent, so a blind retry after an ambiguous network failure is safe: deleting ids that are already gone succeeds, and `deleteIndex()` against an index that no longer exists resolves cleanly rather than erroring.

## Enumeration

An index's dimension, distance metric and non-filterable keys are fixed at
creation, so changing any of them means copying every vector to a new index.
Two generators make that possible, and make an audit possible with it:

```typescript
// What is in this index?
for await (const doc of store.listDocuments()) console.log(doc.id);

// Copy it, embeddings and all.
for await (const { id, vector, document } of store.listVectors()) {
  await target.addVectors([vector], [document], { ids: [id] });
}
```

Both are async generators — memory stays bounded by one page however large the
index, and breaking out of the loop issues no further request. Both take
`{ pageSize, signal }`, where `pageSize` is 1–1,000 and advisory: AWS ends a page
at 1 MB of processed data regardless. Neither takes a filter, because
`ListVectors` accepts none. Both request metadata, so both need
`s3vectors:GetVectors` in addition to `s3vectors:ListVectors`.

## LangChain Integration

The store works with all LangChain patterns that accept a `VectorStore`:

```typescript
// As a retriever. A signal here cancels the AWS request itself; one passed to
// invoke(query, { signal }) ends the invocation only, because core never routes
// a runnable config to a retriever's extension point.
const retriever = store.asRetriever({ k: 5, signal });

// Or with diversity, through core's own MMR dispatch:
const diverse = store.asRetriever({ k: 4, searchType: "mmr", searchKwargs: { fetchK: 20 } });
```

From there it is an ordinary `@langchain/core` retriever, so a RAG chain or an
agent takes it directly:

<!-- sample:skip illustrative: the chain and agent APIs come from packages this one does not depend on -->
```typescript
// In a RAG chain
const chain = RetrievalQAChain.fromLLM(llm, retriever);

// With an agent
const tools = [createRetrieverTool(retriever, { ... })];
```
