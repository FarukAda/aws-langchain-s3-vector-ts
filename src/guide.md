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

When you call `addDocuments()`, each document goes through this pipeline:

1. **Text extraction** — `doc.pageContent` is read
2. **Embedding** — the configured `EmbeddingsInterface` produces a vector
3. **Metadata assembly** — `doc.metadata` is merged with `{ _page_content: doc.pageContent }`
4. **Storage** — the vector + metadata are sent to S3 Vectors via `PutVectorsCommand`

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
// → Peak memory: ~200 vectors at a time, not 10,000
await store.addDocuments(largeDocs, { batchSize: 200 });
```

This matches the Python `langchain-aws` implementation and is critical for production workloads.

## Similarity Search

The library supports five search methods:

| Method | Input | Returns |
|---|---|---|
| `similaritySearch(query, k, filter?, callbacks?, signal?)` | Text string | `Document[]` |
| `similaritySearchWithScore(query, k, filter?, callbacks?, signal?)` | Text string | `[Document, distance][]` |
| `similaritySearchWithRelevanceScores(query, k, filter?, callbacks?, signal?)` | Text string | `[Document, score][]` |
| `similaritySearchVectorWithScore(vector, k, filter?, signal?)` | Raw vector | `[Document, distance][]` |
| `similaritySearchByVector(vector, k, filter?, signal?)` | Raw vector | `Document[]` |

The text-based methods reserve a `Callbacks` slot (accepted and ignored) so they line up with LangChain’s own signatures; the vector-based ones take the `AbortSignal` one position earlier, since they have no callbacks slot. `k` and the filter are validated, and the signal is checked, *before* the query is embedded — an invalid argument or an already-aborted signal never costs a billable `embedQuery` call.

Passing an `AbortSignal` in that `Callbacks` slot raises a coded `VALIDATION` error on all three text-based searches rather than being silently ignored: the search would otherwise run to completion, uncancelled, after already spending a billable `embedQuery` call. Pass it as the fifth argument instead.

**Distance vs. relevance:** S3 Vectors returns a *distance* (lower = more similar). LangChain expects a *relevance score* (higher = more relevant). The library provides built-in conversion functions:

- **Cosine:** `1.0 - distance` → score in `[-1, 1]` (typically `[0, 1]`)
- **Euclidean:** `1.0 - distance / √4096` → score in `[0, 1]`

You can also provide your own via `relevanceScoreFn` in the config.

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
  client, // region/credentials/endpoint in config are ignored
});
```

The client is identified by its `config.serviceId`, not by `instanceof` — so a bundler that duplicates `@aws-sdk/client-s3vectors` across a module boundary, and a legitimate subclass such as a tracing wrapper, both still work. A value that is not an `S3VectorsClient` is rejected with a coded `VALIDATION` error rather than silently replaced: the replacement would be built from the ambient credential chain and default region, which could point the store at a different AWS account. Passing `client: null` or `undefined` simply means "not provided", and the store builds its own from `region`/`credentials`/`endpoint`.

## Error Handling

Every failure this library surfaces — caller mistake, not-found, malformed AWS response, or an underlying AWS error — is a single typed `S3VectorsError` carrying a stable `code`, a `context`, and the original `cause`. No raw AWS SDK error and no bare `TypeError` reaches the caller. Detect it with the exported `isS3VectorsError()` type guard.

| Code | Raised when |
|---|---|
| `VALIDATION` | Caller input was invalid — mismatched counts, a non-array argument, a bad batch size, an empty filter, a reserved metadata key, or a `client` that is not an `S3VectorsClient`. |
| `NOT_FOUND` | A requested vector id was not found by `getByIds`. |
| `EMBEDDINGS_MISSING` | An operation needed an embedding model but none was configured. |
| `AWS_REQUEST_FAILED` | An underlying AWS S3 Vectors request failed. |
| `INDEX_CONFIG_MISMATCH` | The index’s actual dimension or distance metric disagrees with this store’s configuration. |
| `ABORTED` | The supplied `AbortSignal` fired before or during the operation. |
| `AWS_INVALID_RESPONSE` | An AWS response was missing, carried an unusable value for, or wasn't an object at all where this library requires one. Reachable only from a mocked, stubbed or otherwise non-conforming client. |
| `QUERY_PAGE_LIMIT_EXCEEDED` | A paginated search stopped without reaching `k` while more pages were still available — either 10 consecutive pages returned no results at all, or the 1,000-page runaway ceiling was reached. |
| `NOT_IMPLEMENTED` | `maxMarginalRelevanceSearch`, which this store intentionally does not implement. |
| `UNEXPECTED_ERROR` | A failure that never touched AWS — a raw throw from a caller-supplied embeddings model, or input malformed enough to bypass validation. |

`NotFoundException` is still caught and treated as an expected outcome in the two places where absence is the normal case: auto-index detection during a write, and `delete({ deleteAll: true })` against an index that is already gone.

The library fails closed rather than guessing. A query result missing a usable numeric `distance`, a response whose `distanceMetric` cannot be recognised, a response that is not an object at all, and a paginated search that stops making progress before reaching `k` all raise a coded error instead of returning a plausible-looking but wrong result.

Pagination is bounded by progress rather than by a flat page count. AWS documents its `QueryVectors` page size as *up to* 100 results, not exactly 100, so a search needing many pages is normal and is allowed to continue as long as pages keep delivering results; what stops it is an unbroken run of empty pages (a response that will never converge) or a far-off runaway ceiling. AWS pagination tokens are only valid for a few minutes, so a failure partway through a long paginated search reports which page it was on and suggests re-issuing the original query.

On a partial multi-batch failure, the thrown error carries what already succeeded: `context.writtenIds` for writes, `context.deletedIds` for deletes, and `context.foundIds` for `getByIds`. This matters most for auto-generated ids, which nothing else records.

The AWS SDK v3 has built-in retry behaviour (exponential backoff with jitter) for throttling and transient 5xx failures. Configure it with `maxAttempts`/`retryMode`, or on a `S3VectorsClient` you pass in yourself.

## Deletion

The `delete()` method supports two modes:

- **By IDs:** `await store.delete({ ids: ["id1", "id2"] })` — deletes specific vectors (batched, default 500 per call)
- **Entire index:** `await store.delete({ deleteAll: true })` — deletes the whole vector index (not the bucket). `deleteAll` must be explicit; `delete()` with neither `ids` nor `deleteAll` throws instead of guessing, and passing both together is rejected.

Both modes are idempotent, so a blind retry after an ambiguous network failure is safe: deleting ids that are already gone succeeds, and `deleteAll` against an index that no longer exists resolves cleanly rather than erroring.

## LangChain Integration

The store works with all LangChain patterns that accept a `VectorStore`:

```typescript
// As a retriever
const retriever = store.asRetriever({ k: 5 });

// In a RAG chain
const chain = RetrievalQAChain.fromLLM(llm, retriever);

// With an agent
const tools = [createRetrieverTool(retriever, { ... })];
```
