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

The library supports three search modes:

| Method | Input | Returns |
|---|---|---|
| `similaritySearch(query, k, filter?)` | Text string | `Document[]` |
| `similaritySearchWithScore(query, k, filter?)` | Text string | `[Document, distance][]` |
| `similaritySearchVectorWithScore(vector, k, filter?)` | Raw vector | `[Document, distance][]` |

**Distance vs. relevance:** S3 Vectors returns a *distance* (lower = more similar). LangChain expects a *relevance score* (higher = more relevant). The library provides built-in conversion functions:

- **Cosine:** `1.0 - distance` → score in `[-1, 1]` (typically `[0, 1]`)
- **Euclidean:** `1.0 - distance / √4096` → score in `[0, 1]`

You can also provide your own via `relevanceScoreFn` in the config.

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

## Error Handling

The library handles errors at two levels:

1. **Input validation** — mismatched array lengths throw immediately with clear messages
2. **AWS errors** — `NotFoundException` is caught during auto-index detection (expected workflow). All other AWS SDK errors propagate to the caller

The AWS SDK v3 has built-in retry behaviour (exponential backoff with jitter). You can configure this on the `S3VectorsClient` if needed.

## Deletion

The `delete()` method supports two modes:

- **By IDs:** `await store.delete({ ids: ["id1", "id2"] })` — deletes specific vectors (batched, default 500 per call)
- **Entire index:** `await store.delete()` — deletes the whole vector index (not the bucket)

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
