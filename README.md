# @farukada/aws-langchain-s3-vector-ts

[![npm version](https://img.shields.io/npm/v/%40farukada%2Faws-langchain-s3-vector-ts)](https://www.npmjs.com/package/@farukada/aws-langchain-s3-vector-ts)
[![CI](https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions/workflows/ci.yml)
[![CodeQL](https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions/workflows/codeql.yml/badge.svg)](https://github.com/FarukAda/aws-langchain-s3-vector-ts/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/FarukAda/aws-langchain-s3-vector-ts/badge)](https://scorecard.dev/viewer/?uri=github.com/FarukAda/aws-langchain-s3-vector-ts)
![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![AWS SDK v3](https://img.shields.io/badge/AWS%20SDK-v3-FF9900)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea44f?logo=npm)](https://www.npmjs.com/package/@farukada/aws-langchain-s3-vector-ts#provenance)
[![coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](#-testing)
[![Sponsor](https://img.shields.io/badge/Sponsor-FarukAda-ea4aaa?logo=githubsponsors)](https://github.com/sponsors/FarukAda)

Built with [LangChain](https://github.com/langchain-ai/langchainjs) · [AWS SDK v3](https://aws.amazon.com/sdk-for-javascript/) · [npm](https://www.npmjs.com/package/@farukada/aws-langchain-s3-vector-ts) · [GitHub](https://github.com/FarukAda/aws-langchain-s3-vector-ts) · [Issues](https://github.com/FarukAda/aws-langchain-s3-vector-ts/issues)

---

Drop-in LangChain-compatible **vector store** backed by [Amazon S3 Vectors](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html). Stores, queries, and manages vector embeddings using the native AWS S3 Vectors service with full TypeScript type safety. Every behaviour below is specified against the AWS API references, the `@aws-sdk/client-s3vectors` service model, and `@langchain/core` itself — and, where the service's behaviour is undocumented, against recorded live probes in [`docs/evidence/`](docs/evidence/) that a live test re-checks.

## Table of Contents

- [Features](#-key-features)
- [Architecture](#️-architecture)
- [Quick Start](#-quick-start)
- [Usage Examples](#-usage-examples)
- [Infrastructure Setup](#️-infrastructure-setup)
- [Configuration Reference](#️-configuration-reference)
- [Advanced Features](#-advanced-features)
- [API Reference](#-api-reference)
- [IAM Permissions](#-iam-permissions)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Key Features

| | Feature | Description |
|---|---|---|
| ☁️ | **Cloud-Native** | Direct integration with Amazon S3 Vectors via `@aws-sdk/client-s3vectors` |
| 🚀 | **Performance-First** | Per-batch embedding for low peak memory, configurable batch sizes |
| 🛡️ | **Fully Type-Safe** | Built with strict TypeScript 6, exported types for all config surfaces |
| 🔌 | **Drop-In Compatible** | Extends LangChain.js `VectorStore` — works with `asRetriever()`, RAG chains, agents |
| ⚙️ | **Auto-Provisioning** | Automatically creates the vector index on first write |
| 🔍 | **Metadata Filtering** | Native S3 Vectors metadata filters for similarity search |
| 🎯 | **MMR and Enumeration** | Diversity-aware search through core's own algorithm, plus `listDocuments`/`listVectors` for audit and migration |
| 🧾 | **Specified, Not Guessed** | Every behaviour is cited to an AWS reference, the SDK model, or a recorded live probe under [`docs/evidence/`](docs/evidence/) that a live test re-checks |
| 🔐 | **Supply-Chain Hardened** | Published with npm provenance attestations via GitHub OIDC Trusted Publishing |

## 🏗️ Architecture

```mermaid
graph LR
    A[Your Application] --> B["AmazonS3Vectors"]
    B --> C["EmbeddingsInterface"]
    B --> D["S3VectorsClient"]
    C --> |"embedDocuments()"| B
    D --> E["Amazon S3 Vectors"]
    E --> F["Vector Bucket"]
    F --> G["Vector Index"]

    style A fill:#2d3748,stroke:#4a5568,color:#fff
    style B fill:#3182ce,stroke:#2b6cb0,color:#fff
    style C fill:#38a169,stroke:#2f855a,color:#fff
    style D fill:#dd6b20,stroke:#c05621,color:#fff
    style E fill:#805ad5,stroke:#6b46c1,color:#fff
    style F fill:#805ad5,stroke:#6b46c1,color:#fff
    style G fill:#805ad5,stroke:#6b46c1,color:#fff
```

**Data flow on write (`addDocuments`):**

1. Documents are chunked into batches of 200 (configurable).
2. Each batch is embedded via the supplied `EmbeddingsInterface`.
3. On the first write this store instance makes (not just the first batch of *this* call), and only when `createIndexIfNotExist` is enabled (the default), the library checks whether the index exists via `GetIndexCommand` and creates it via `CreateIndexCommand` if it does not, with the `dimension` taken from the first vector. Once it knows the index exists, every later write is a single `PutVectorsCommand`. Nothing else is cached: the dimension is enforced by AWS on every write, and the distance metric is checked against the `QueryVectors` response on every read, so there is no stale copy of the index configuration to go wrong. A `PutVectors` that reports the index gone clears the flag, so the next write re-checks and re-creates it.
4. Vectors plus metadata are sent via `PutVectorsCommand` — one SDK call per batch, pipelined against the embedding of the next batch, at most `maxConcurrentBatchCalls` in flight.
5. Page content is stored as a special metadata key (`_page_content` by default) and transparently extracted on reads.

**Data flow on read (`similaritySearch*`):**

1. The query is embedded via the query-side embedding model (falls back to the indexing model).
2. `QueryVectorsCommand` sends the vector with `returnMetadata: true` and optionally `returnDistance: true`.
3. Results are reconstructed as LangChain `Document` objects, lifting the page content out of metadata.

## 📦 Quick Start

### Installation

```bash
npm install @farukada/aws-langchain-s3-vector-ts @aws-sdk/client-s3vectors @langchain/core
```

### Peer Dependencies

| Package | Version |
|---|---|
| `@aws-sdk/client-s3vectors` | `^3.1133.0` |
| `@langchain/core` | `^1.2.11` |

### Runtime Requirements

- **Node.js** `>= 22`. Node 20 reached end of life on 30 April 2026 and is no longer tested; CI runs 22 and 24 on Linux, macOS and Windows. Both peer dependencies still accept Node 20 and nothing in this package's runtime needs a newer API — the floor tracks maintained Node lines, not a feature. (Publishing this package to npm separately requires Node ≥24, for npm Trusted Publishing's npm-CLI requirement — that's a CI/release-only constraint and doesn't affect consumers.)
- **npm** `>= 10.0.0`.
- **Module format:** dual. The package ships an ES module build (`dist/esm/`) and a CommonJS build (`dist/cjs/`) compiled from the same source, and the `exports` map serves each consumer the matching one with its own declarations — `import` resolves to ESM and `require` to CommonJS on every supported Node version, with no dependence on Node's `require(esm)`. The shape is verified on every commit by [publint](https://publint.dev/) and [arethetypeswrong](https://arethetypeswrong.github.io/), and the packed tarball is installed into a fresh project and used from ESM, CommonJS and a TypeScript 5 consumer in CI.
  - `import { AmazonS3Vectors } from '@farukada/aws-langchain-s3-vector-ts';` — ESM and TypeScript.
  - `const { AmazonS3Vectors } = require('@farukada/aws-langchain-s3-vector-ts');` — CommonJS.
  - A process that mixes both loads two copies of the module. `isS3VectorsError` recognises errors from either copy (it brands with a shared `Symbol.for`, never `instanceof`), so an error thrown inside a CommonJS dependency is still identifiable from ESM code, and vice versa.
- **Tree-shaking:** the package declares `"sideEffects": false` — importing one export does not pull in module-level side effects, so bundlers may drop what you don't use.

### Basic Usage

```typescript
import { AmazonS3Vectors } from "@farukada/aws-langchain-s3-vector-ts";
import { BedrockEmbeddings } from "@langchain/aws";
import { Document } from "@langchain/core/documents";

const store = new AmazonS3Vectors(new BedrockEmbeddings(), {
  vectorBucketName: "my-vector-bucket",
  indexName: "my-index",
  region: "us-east-1",
});

// Add documents — embeddings are computed per batch automatically
await store.addDocuments([
  new Document({ pageContent: "Star Wars", metadata: { genre: "scifi" } }),
  new Document({ pageContent: "Finding Nemo", metadata: { genre: "family" } }),
]);

// Similarity search
const results = await store.similaritySearch("space adventure", 4);
```

## 📖 Usage Examples

### Add Documents

```typescript
import { Document } from "@langchain/core/documents";

const ids = await store.addDocuments([
  new Document({ pageContent: "hello world", metadata: { source: "greeting" } }),
  new Document({ pageContent: "goodbye world", metadata: { source: "farewell" } }),
]);
```

`AmazonS3Vectors.fromTexts(texts, metadatas, embeddings, config)` does the
text-to-`Document` mapping for you when you are building a store from scratch.

### Similarity Search with Scores

The raw score is the `distance` returned by S3 Vectors — lower means more similar for both `cosine` and `euclidean` metrics.

```typescript
const results = await store.similaritySearchWithScore("neural networks", 5);
for (const [doc, distance] of results) {
  console.log(`${doc.pageContent} (distance: ${distance})`);
}
```

### Relevance Scores (for LangChain retrievers)

LangChain expects a *relevance score* (higher is better). A cosine index has one built in:

```typescript
import { cosineRelevanceScoreFn } from "@farukada/aws-langchain-s3-vector-ts";
// 1.0 - distance. Cosine distance is exactly 1 - cosine similarity
// (docs/evidence/cosine-distance.md), so the range is [-1, 1] — and [0, 1]
// for the normalized embeddings most models produce.
```

**A euclidean index has none, and asking for one fails closed.**
`similaritySearchWithRelevanceScores` on a euclidean store with no
`relevanceScoreFn` raises `VALIDATION` rather than returning a number. Euclidean
distance is unbounded above, so no fixed formula can map it to a comparable
score without knowing your embedding's scale — which only you know. Supply your
own, or use `similaritySearchWithScore` and threshold on the raw distance:

```typescript
const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "bucket",
  indexName: "index",
  distanceMetric: "euclidean",
  relevanceScoreFn: (d) => 1 / (1 + d),
});
```

Use it via `similaritySearchWithRelevanceScores`:

```typescript
const results = await store.similaritySearchWithRelevanceScores("neural networks", 5);
for (const [doc, score] of results) {
  console.log(`${doc.pageContent} (relevance: ${score})`);
}
```

### Metadata Filtering

S3 Vectors supports a MongoDB-style filter syntax:

```typescript
const filtered = await store.similaritySearch(
  "adventure",
  4,
  { genre: { $eq: "scifi" } },
);

// Range + combinator filters
const recent = await store.similaritySearch(
  "announcement",
  10,
  {
    $and: [
      { year: { $gte: 2024 } },
      { category: { $in: ["product", "security"] } },
    ],
  },
);
```

A few behaviours worth knowing, each recorded with its raw traffic in [`docs/evidence/filter-validation.md`](docs/evidence/filter-validation.md) and re-checked by a live test, so a change on AWS's side fails a run rather than quietly making this section wrong:

- **Don't pass an empty filter object.** `similaritySearch(query, k, {})` throws locally (AWS itself rejects `{}` with an opaque "Invalid filter" error rather than treating it as "no filter"). Omit the `filter` argument entirely — or pass `undefined` — to search without filtering. This matters if you build a filter dynamically and it can end up with no conditions applied.
- **One condition per object.** `{ genre: "scifi", year: 2020 }` is not an implicit AND: S3 Vectors rejects any condition object with more than one key, at the top level and inside `$and`/`$or` alike. Combine conditions explicitly — `{ $and: [{ genre: "scifi" }, { year: 2020 }] }`. Several *operators* on one field are fine: `{ year: { $gte: 2020, $lte: 2024 } }`. This library refuses the multi-key form locally, with a message showing the `$and` to write instead.
- **Operands have types.** `$eq`, `$ne` and the shorthand `{ field: value }` take a string, a number or a boolean; `$gt`, `$gte`, `$lt` and `$lte` take a number; `$in` and `$nin` take a non-empty array of those (mixed types are fine, `null` is not); `$exists` takes a boolean. A field's operator object holds only these operators — `{ genre: {} }`, `{ doc: { title: "x" } }` and `$and` inside a field are all rejected. Each rule was confirmed live, and each is enforced locally, naming the path and the rule, instead of arriving as AWS's bare "Invalid filter".
- **`NaN`, `Infinity` and `Date` are refused.** The AWS SDK sends a non-finite number as a string and a `Date` as a timestamp, so AWS would accept them and the filter would silently match nothing — or compare against a number you never wrote. Convert a date yourself to the representation the field was written with.
- **A type-mismatched comparison returns zero results, not an error.** Comparing a boolean-valued field against a string (e.g. `{ popular: { $eq: "true" } }` when `popular` is actually stored as the boolean `true`) silently matches nothing rather than failing — indistinguishable from filtering on a field that doesn't exist on any document at all. This library cannot catch it for you: the stored type is the writer's and the filter value is the reader's, and no single call sees both. Watch for it wherever a filter value arrives from a query string or a form, where everything is a string.
- **You can't filter on a non-filterable key.** Filtering on `pageContentMetadataKey` (or any key listed in `nonFilterableMetadataKeys`) fails with an "Invalid use of non-filterable metadata in filter" error — expected, since that's the whole point of the non-filterable list, but easy to hit by accident if you filter on the same key you excluded for index-size reasons.

### Use as a LangChain Retriever

```typescript
const retriever = store.asRetriever({ k: 5 });
const docs = await retriever.invoke("space exploration");

// With filter
const filteredRetriever = store.asRetriever({
  k: 3,
  filter: { genre: { $eq: "scifi" } },
});
```

### Raw-Vector-Only Workflow (No Embeddings Model)

When you already have vectors (e.g., from a separate embedding service):

```typescript
const store = new AmazonS3Vectors(undefined, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  region: "us-east-1",
});

await store.addVectors(
  [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
  [
    new Document({ pageContent: "first" }),
    new Document({ pageContent: "second" }),
  ],
);

const results = await store.similaritySearchVectorWithScore([0.1, 0.2, 0.3], 2);
```

### Separate Query Embeddings

Some embedding providers differentiate between document-side and query-side models (e.g., Cohere's `input_type`):

```typescript
const store = new AmazonS3Vectors(documentEmbeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  queryEmbeddings: queryEmbeddings, // falls back to documentEmbeddings if omitted
});
```

### Bring Your Own Client

```typescript
import { S3VectorsClient } from "@aws-sdk/client-s3vectors";

const client = new S3VectorsClient({
  region: "eu-west-1",
  credentials: myCredentialProvider, // however your application resolves them
});

const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  client, // exclusive with region/credentials/endpoint/maxAttempts/retryMode/the three timeouts
});
```

### Static Factories

```typescript
// From texts
const fromTexts = await AmazonS3Vectors.fromTexts(
  ["hello", "world"],
  [{ source: "a" }, { source: "b" }],
  new BedrockEmbeddings(),
  { vectorBucketName: "my-bucket", indexName: "my-index", region: "us-east-1" },
);

// From documents
const fromDocuments = await AmazonS3Vectors.fromDocuments(
  docs,
  new BedrockEmbeddings(),
  { vectorBucketName: "my-bucket", indexName: "my-index", region: "us-east-1" },
);
```

## 🏗️ Infrastructure Setup

> **Prerequisite:** You must manually create the S3 vector bucket before using this library. The vector index inside the bucket is created automatically on first write (unless you disable `createIndexIfNotExist`).

<details>
<summary><strong>AWS CLI</strong></summary>

```bash
# Create the vector bucket
aws s3vectors create-vector-bucket \
  --vector-bucket-name my-vector-bucket

# (Optional) Create the vector index manually — otherwise the library
# creates it on first write.
#
# --metadata-configuration is NOT optional if you then write through this
# library with its default `pageContentMetadataKey`. An index created without
# it treats `_page_content` as filterable, which spends the 2 KB filterable
# budget on document text; the store refuses the first write with
# INDEX_CONFIG_MISMATCH rather than writing into that. A non-filterable key
# set is fixed at creation and cannot be changed afterwards.
aws s3vectors create-index \
  --vector-bucket-name my-vector-bucket \
  --index-name my-index \
  --data-type float32 \
  --dimension 1536 \
  --distance-metric cosine \
  --metadata-configuration '{"nonFilterableMetadataKeys":["_page_content"]}'
```

If you set a custom `pageContentMetadataKey`, use that name instead; add any
`nonFilterableMetadataKeys` you configure to the same list; and if you set
`pageContentMetadataKey: null`, omit the flag entirely. The rule is simply that
the index's list and the store's must match — letting the library create the
index is the way to not have to think about it.

</details>

<details>
<summary><strong>AWS Console</strong></summary>

1. Open the **Amazon S3 console**.
2. Select **Vector buckets** in the left navigation.
3. Choose **Create vector bucket** and supply a bucket name.
4. Leave the index creation to the library (automatic on first write). This is the recommended path: the library creates the index with the `dimension` from your first vector *and* with `pageContentMetadataKey` in its non-filterable metadata keys.
5. If you create the index by hand instead, match both: the `dimension` for your embedding model, and a non-filterable metadata key list containing `_page_content` (or whatever `pageContentMetadataKey` you configure). A mismatch is refused on the first write with `INDEX_CONFIG_MISMATCH`, and cannot be corrected afterwards — the list is fixed at creation.

</details>

<details>
<summary><strong>AWS CDK (TypeScript)</strong></summary>

There are still no L2 constructs, but `aws-cdk-lib` ships typed **L1** constructs for both resources — `aws_s3vectors.CfnVectorBucket` (`AWS::S3Vectors::VectorBucket`) and `aws_s3vectors.CfnIndex` (`AWS::S3Vectors::Index`) — so a raw `CfnResource` is no longer needed. Checked against `aws-cdk-lib` 2.269.0.

<!-- sample:skip illustrative: aws-cdk-lib is not a dependency of this package -->
```typescript
import { aws_s3vectors as s3vectors } from "aws-cdk-lib";

const bucket = new s3vectors.CfnVectorBucket(this, "VectorBucket", {
  vectorBucketName: "my-vector-bucket",
});

new s3vectors.CfnIndex(this, "VectorIndex", {
  vectorBucketName: bucket.vectorBucketName,
  indexName: "my-index",
  dataType: "float32",
  dimension: 1536,
  distanceMetric: "cosine",
  // Same rule as the CLI above: this must match the store's configuration,
  // and it is fixed at creation.
  metadataConfiguration: { nonFilterableMetadataKeys: ["_page_content"] },
});
```

</details>

## ⚙️ Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `vectorBucketName` | `string` | **required** | Name of an existing S3 vector bucket |
| `indexName` | `string` | **required** | Name of the vector index (3–63 chars; lowercase letters, numbers, `-`, `.`) |
| `client` | `S3VectorsClient` | — | Pre-configured SDK client. Mutually exclusive with every option that would configure one: supplying `client` together with `region`, `credentials`, `endpoint`, `maxAttempts`, `retryMode`, `connectionTimeout`, `socketTimeout` or `requestTimeout` raises `VALIDATION` rather than silently ignoring them |
| `region` | `string` | — | AWS region (not allowed together with `client`) |
| `credentials` | `AwsCredentialIdentity` | — | AWS credentials (not allowed together with `client`) |
| `endpoint` | `string` | — | Custom endpoint URL (not allowed together with `client`) |
| `dataType` | `"float32"` | `"float32"` | Vector data type (S3 Vectors currently only supports `float32`) |
| `distanceMetric` | `"cosine" \| "euclidean"` | `"cosine"` | Distance metric for similarity search |
| `createIndexIfNotExist` | `boolean` | `true` | Auto-create the index on first write. `false` issues **no** `GetIndex` at all: nothing is validated locally that AWS does not already enforce, so a store that never creates an index needs no control-plane permission — see [IAM Permissions](#-iam-permissions) |
| `encryptionConfiguration` | `EncryptionConfiguration` (SDK type) | bucket default | Server-side encryption for an index **this store creates**, e.g. `{ sseType: "aws:kms", kmsKeyArn: "arn:aws:kms:…" }`. Ignored for an existing index (encryption is fixed at creation; S3 Vectors has no `UpdateIndex`) |
| `tags` | `Record<string, string>` | — | Tags applied to an index **this store creates** (cost allocation, ABAC). Ignored for an existing index |
| `maxConcurrentBatchCalls` | `number` | `10` | Cap on concurrent `PutVectors`/`DeleteVectors`/`GetVectors` calls during batched writes, deletes and fetches. Lower it (down to `1`) to share a quota with other workloads; raise it against a generous rate limit. Peak in-flight write payload scales with `maxConcurrentBatchCalls × batchSize` — see [Rate Limits, Payload Limits and Cost](#rate-limits-payload-limits-and-cost) |
| `pageContentMetadataKey` | `string \| null` | `"_page_content"` | Metadata key for storing `Document.pageContent`; `null` to disable round-tripping |
| `nonFilterableMetadataKeys` | `string[]` | — | Metadata keys excluded from query filters (reduces index size for large values). When this library creates a new index, `pageContentMetadataKey` is added to this list too — and if that takes the total past S3 Vectors' 10-key cap, creation is refused with `VALIDATION` rather than the key being silently dropped. This list must also match the index being written to: it sets the local 2 KB filterable-metadata budget, and a disagreement with an existing index raises `INDEX_CONFIG_MISMATCH`. See [Non-Filterable Metadata Keys](#non-filterable-metadata-keys). |
| `queryEmbeddings` | `EmbeddingsInterface` | — | Separate embedding model for queries only |
| `relevanceScoreFn` | `(distance: number) => number` | — | Custom distance-to-score conversion |
| `embeddings` | `EmbeddingsInterface` | — | Alternative to the positional `embeddings` argument |
| `maxAttempts` | `number` | SDK default | Max attempts (initial + retries) for AWS requests (not allowed together with `client`) |
| `retryMode` | `"standard" \| "adaptive" \| "legacy"` | SDK default | AWS SDK retry mode (not allowed together with `client`) |
| `connectionTimeout` | `number` (ms) | `5000` | Ceiling on the connection phase of a request; `0` disables it (not allowed together with `client`) |
| `socketTimeout` | `number` (ms) | `60000` | Ceiling on how long a socket may sit **idle** before the request fails — the one that ends a request to an endpoint that accepts the connection and then never answers. Being idle-based, it does not cut short a large upload that is still making progress. `0` disables it (not allowed together with `client`) |
| `requestTimeout` | `number` (ms) | — | A **total** deadline for a request and its response. Deliberately not defaulted: a 500-vector batch at 4,096 dimensions is a large upload, and a deadline would end it however healthy the transfer is. Setting it also sets the SDK's `throwOnRequestTimeout`, without which the SDK only warns and keeps waiting. `0` disables it (not allowed together with `client`) |

Every method that takes an options bag — `addVectors`, `addDocuments`, `getByIds`, `delete`, `deleteIndex`, `listDocuments`, `listVectors`, `maxMarginalRelevanceSearch` — refuses a non-object one with `VALIDATION` rather than reading each option in it as unset. `undefined` and `null` still mean "no options". The two enumeration methods raise it on the first `next()`, where an out-of-range `pageSize` is also raised, so one `try` around the loop catches both.

**Every option above is validated at construction, before any AWS call.** A closed-set option (`distanceMetric`, `dataType`, `encryptionConfiguration.sseType`) is checked against the SDK's own enum, so the check cannot drift from the service model; the rest are shape and bound checks (`pageContentMetadataKey` 1–63 characters or `null` and never `__proto__`, `nonFilterableMetadataKeys` an array of strings, `relevanceScoreFn` a function, `tags` string keys of 1–128 and values of at most 256 characters, `maxConcurrentBatchCalls` a positive integer, `region` a non-empty string, `endpoint` an absolute URL, `credentials` a credential pair or a provider function, `maxAttempts` an integer of 1 or more, `createIndexIfNotExist` a boolean — the string `"false"` an environment variable hands you is refused, not read as truthy — and each of the three timeouts a non-negative integer). Each raises `VALIDATION` naming the option, and the `credentials` message describes the value by kind without ever echoing it. The alternative is a round trip that fails, or — for `relevanceScoreFn` — an uncoded `TypeError` thrown from inside a search hours later.

Constructing a store issues no AWS request.

Full generated API docs: see [`docs/`](docs/) (TypeDoc output).

Only the options listed above are read by this library. The constructor builds its `S3VectorsClient` from exactly `region`, `credentials`, `endpoint`, `maxAttempts`, `retryMode` and a `requestHandler` carrying the three timeouts — any other `S3VectorsClientConfig` field (a `logger`, a `customUserAgent`, a proxy, a fully custom `retryStrategy`, a `requestHandler` of your own, …) is **not** passed through. Build the client yourself and hand it in via `client` for anything beyond those; every operation then flows through your client unchanged, its own timeouts included, and this library imposes none of its own on it.

### Retries

Throttling (`TooManyRequestsException`, HTTP 429 — S3 Vectors' name for it; not `ThrottlingException`, which several other AWS services use and this one never sends) and transient 5xx failures are retried automatically by the AWS SDK's retry strategy — **3 attempts total (1 + 2 retries) with exponential backoff and jitter** under the default `"standard"` mode. This library adds no retry layer of its own: a `THROTTLED` or `SERVICE_UNAVAILABLE` error you catch means the SDK's attempts were exhausted.

Tune it with `maxAttempts` / `retryMode`, or pass a fully pre-configured `client`:

- **`retryMode: "adaptive"`** is the better default for bulk ingest against a shared account. It adds a client-side token bucket that slows the *request rate* on throttling instead of only retrying — so a large `addDocuments` against a busy quota degrades to a steady trickle rather than a burst of 429s that exhaust `maxAttempts`.
- **`maxAttempts`** controls attempts per individual call (e.g. one `PutVectors` batch), not per `addDocuments`. Raising it lengthens the worst-case time a single batch can block.
- Every error from an AWS call carries `context.retryable` (`true` for throttling, 5xx and a timed-out or reset connection), `context.awsErrorName`, `context.httpStatusCode` and `context.requestId`, so an application-level retry or dead-letter decision can be made from the error alone — see [Errors](#errors).

The embeddings side is different: `embedDocuments`/`embedQuery` come from *your* embeddings model, and this library never retries them (the interface gives no way to know whether a failure is safe to retry). Configure retries on the embeddings client itself.

### Errors

Every failure — validation, not-found, or an underlying AWS error — is surfaced as a single typed `S3VectorsError` carrying a `code` (`S3VectorsErrorCode`), a `context` (`{ operation, vectorBucketName, indexName, … }`), and the original `cause`. Detect it with the exported `isS3VectorsError()` guard — it's a proper TypeScript type guard, so a caught `unknown` narrows to `S3VectorsError` without a cast:

```typescript
try {
  await store.addDocuments(docs);
} catch (e) {
  if (isS3VectorsError(e)) {
    console.error(e.code, e.message); // e is narrowed, no `as S3VectorsError` needed
  }
}
```

**Partial-batch failures report what already succeeded.** Nothing is written for an input this library can refuse: every document, id and vector it can check is checked before the first request, and — for `addDocuments` — before the first embedding call. A multi-batch write can still fail partway (a later batch throttled, a transient error, an embeddings model returning an unusable vector for a later batch), and then earlier batches are already durably committed in AWS — the thrown error's `context.writtenIds` lists every id confirmed written before the failure, including any concurrent batch that happened to succeed alongside the one that failed. This matters most with auto-generated ids: without `context.writtenIds`, those vectors would be undiscoverable and impossible to clean up or reconcile, since nothing else records what id they landed under. `delete({ ids })` reports the equivalent `context.deletedIds` on a partial failure — lower-stakes since delete is idempotent (a blind retry of the full `ids` list is always safe), but still useful to know exactly what happened. `deleteIndex()` is idempotent in the same way: deleting an index that is already gone resolves cleanly instead of erroring, so retrying after an ambiguous network failure is safe.

This partial-progress guarantee doesn't extend to search: if a multi-page `QueryVectors` pagination sequence fails partway through, any pages already fetched are discarded rather than returned alongside the error. Reasonable asymmetry — a failed search is side-effect-free and trivially retryable, unlike a failed write — but worth knowing if you're relying on `writtenIds`/`deletedIds`-style partial-progress reporting from a read path too. The error does still report *how far* it got, via `context.pagesScanned` and `context.resultsCollected`, and a failure on page 2 or later says so explicitly — AWS pagination tokens are only valid for a few minutes, so the fix for a long-running paginated search is to re-issue the original query rather than resume it.

```typescript
try {
  await store.addDocuments(manyDocuments); // ids auto-generated
} catch (e) {
  if (isS3VectorsError(e) && e.context.writtenIds?.length) {
    console.warn(`${e.context.writtenIds.length} vectors already written before the failure:`, e.context.writtenIds);
  }
}
```

The codes are stable and exhaustive. Everything a caller branches on is its own
class, decided from the exception's `name`, which is a literal type on every
exception the service declares — never a substring match on a message:

| Code | Raised when |
| --- | --- |
| `VALIDATION` | Caller input was invalid — a mismatched count, a missing or non-array argument, an options bag that is not an object, the removed `deleteAll` option, a document, text or `metadatas` entry of the wrong type, a bad batch size, page size, `k`, `fetchK` or `lambda`, a `signal` that is not an `AbortSignal` or is passed in the callbacks slot, a malformed filter (one condition per object, operand types per operator, no `NaN`/`Date`), a reserved metadata key or metadata S3 Vectors cannot store (including an empty or mixed array), a malformed or repeated vector id, a vector S3 Vectors cannot store or search with, a string that is not well-formed UTF-16 anywhere it would be sent to AWS, a text query that is not a string, a configuration option outside its documented set, a `client` supplied alongside the options that would configure one, or a relevance-score search on a euclidean index with no `relevanceScoreFn`. Also an embeddings model returning something other than one storable vector per document, or an unusable query vector; and response metadata `structuredClone` cannot copy, which only a non-conforming client returns. Raised before any AWS call and before any billable embedding, with three exceptions. A model's output is refused after that embedding call and before the request it would feed; on a write it carries `context.writtenIds`, because earlier batches may already be written. A `nonFilterableMetadataKeys` list no index can be created with — more than 10 keys with the page-content key, or a key outside 1–63 characters — is refused when a write first creates the index: after its `GetIndex` and, for `addDocuments`, after the first batch is embedded, with nothing written. Uncopyable response metadata is refused after that response. An error about one element of a list carries `context.recordIndex` (its position in your input) and, where it has one, `context.recordId`. |
| `AWS_REJECTED` | `ValidationException` (400): AWS itself refused the request. `context.fieldList` carries the field-level detail AWS returned, which is the actionable half of an otherwise opaque rejection. |
| `THROTTLED` | `TooManyRequestsException` (429). Retry after a backoff; the SDK has already retried. |
| `SERVICE_UNAVAILABLE` | `InternalServerException` (500), `ServiceUnavailableException` (503) or `RequestTimeoutException` (408), or the SDK's own `TimeoutError` — a connection, socket-idle or request timeout, or a connection reset or broken on the way. Transient — except that a 503 from `PutVectors` is also AWS's documented answer to a batch exceeding resource capacity, which backoff cannot fix. The two are indistinguishable by code, so a write failure carries `context.batchSize`: that is what tells you whether to back off or to split. |
| `ACCESS_DENIED` | `AccessDeniedException` (403). An IAM problem, not a retryable one. Enumeration also raises this when `s3vectors:GetVectors` is missing, and says so. |
| `QUOTA_EXCEEDED` | `ServiceQuotaExceededException` (402). Needs a quota increase, not a retry. |
| `CONFLICT` | `ConflictException` (409) from `CreateIndex`: the index already exists. Two writers racing to create the same index is normal and handled internally; this surfaces only when it is not that race. |
| `KMS_ERROR` | One of the four KMS exceptions (400). Key state — an operator's problem, not a caller's. |
| `NOT_FOUND` | `NotFoundException` (404): the bucket or index is not there. **Not** a missing vector id — `getByIds` reports that as `undefined` in the id's slot (see [`getByIds` and missing ids](#getbyids-and-missing-ids)). |
| `EMBEDDINGS_MISSING` | An operation needed an embedding model but none was configured. The message names which option to set. |
| `AWS_REQUEST_FAILED` | An AWS request failed and no narrower class applies. `context.awsErrorName`/`httpStatusCode`/`requestId`/`retryable` say which and whether to retry. |
| `INDEX_CONFIG_MISMATCH` | An existing index disagrees with this store's configuration: its distance metric, checked against the `QueryVectors` response on every read so it cannot go stale, or its non-filterable metadata keys, checked against the `GetIndex` that precedes a first write. Also raised when the vectors a write is given disagree on dimension — anywhere in an `addVectors` call, before any request; within one embedded batch for `addDocuments`, before that batch is written. |
| `ABORTED` | The supplied `AbortSignal` fired before or during the operation. `error.cause` is the signal's `reason`, always normalised to an `Error`. |
| `AWS_INVALID_RESPONSE` | An AWS response was missing, or carried an unusable value for, something this library requires — a non-numeric `distance`, an unrecognised `distanceMetric`, a vector returned without data despite `returnData: true`, or a response that was not an object at all. Reachable only from a mocked, stubbed or otherwise non-conforming client. |
| `QUERY_PAGE_LIMIT_EXCEEDED` | A paginated search reached this library's 1,000-page runaway ceiling with pages still outstanding and fewer than `k` results collected. `context.pagesScanned` and `context.resultsCollected` say how far short it fell — narrow the filter or lower `k`. A search that legitimately runs out of matches returns what it found, without error; that ambiguity is exactly what this code removes. |
| `UNEXPECTED_ERROR` | A failure that never touched AWS — a raw throw from a caller-supplied embeddings model, or input malformed enough to bypass validation. |

**The codes are append-only for `1.x`.** A value is never removed, never renamed, and never reassigned to a different condition; `S3VectorsErrorContext` only gains fields, and `operation` is always present. Error *messages* are not covered — branch on `code`, on `context` and on `cause`, never on text. `isS3VectorsError` is the supported way to recognise these errors: it checks a brand, `Symbol.for('@farukada/aws-langchain-s3-vector-ts:S3VectorsError')`, rather than `instanceof`, so it works across realms and across the ESM and CommonJS copies of the module, and that brand string is stable for `1.x` too.

**Logging errors safely.** `error.context.instance` (set only by the `fromDocuments`/`fromTexts` factories) is a live store handle for programmatic recovery. It is a *non-enumerable* property, so `JSON.stringify(error.context)`, `util.inspect(error)`, `console.error(error)` and structured loggers all omit it; direct access still works. Independently of that, the store keeps every internal — the SDK `client` included — in a `#private` field, so it is neither an enumerable own property nor reachable from outside the class at all, and `credentials` are additionally excluded from LangChain's `lc_kwargs`. Printing a store, or an error that carries one, therefore cannot leak credential material. Regression tests pin both, and a third pins that no internal name appears in `util.inspect(store)` at depth.

### Maximal Marginal Relevance (MMR)

`maxMarginalRelevanceSearch(query, { k, fetchK, lambda }, callbacks?, signal?)` is
implemented: `fetchK` candidates come from `QueryVectors`, their embeddings from
`GetVectors`, and the selection from `@langchain/core`'s own
`maximalMarginalRelevance` — so the ranking is core's, not a reimplementation.

```typescript
const diverse = await store.maxMarginalRelevanceSearch("space exploration", {
  k: 4,          // documents returned
  fetchK: 20,    // candidates considered first
  lambda: 0.5,   // 0 = diversity only, 1 = relevance only
});
```

It costs two round trips rather than one, because S3 Vectors does not return
vector data from `QueryVectors`. A candidate that the search listed but the
fetch no longer holds — deleted between the two calls — is skipped silently:
MMR is a ranking heuristic, and failing a whole search because one of twenty
candidates vanished would make it fragile in exactly the workloads that use it.

The fourth parameter is a `signal`, which this package adds: core declares three
and passes no config to a retriever's extension point, so there is no other
route for a retriever-scoped signal to reach the AWS requests.

### Enumeration

An index's dimension, distance metric and non-filterable keys are fixed at
creation, so changing any of them means copying every vector into a new index.
That makes enumeration a capability this package has to provide rather than an
operational extra:

```typescript
// Audit: what is in this index?
for await (const doc of store.listDocuments()) {
  console.log(doc.id, doc.pageContent);
}

// Migrate: copy an index whose dimension or metric must change.
const ids: string[] = [];
const vectors: number[][] = [];
const documents: Document[] = [];
for await (const { id, vector, document } of store.listVectors()) {
  ids.push(id);
  vectors.push(vector);
  documents.push(document);
}
await target.addVectors(vectors, documents, { ids });
```

Both are async generators, so memory stays bounded by one page however large the
index, and breaking out of the loop issues no further request. Both accept
`{ pageSize, signal }`; `pageSize` is 1–1,000 and **advisory**, because AWS ends
a page at 1 MB of processed data regardless — a short page is normal, and only
an absent `nextToken` ends a listing. Neither accepts a filter: `ListVectors`
takes none, and enumerating to discard client-side would bill for the whole
index while looking like a server-side filter.

They are two methods rather than one flag because they are economically
different: at 1,536 dimensions a vector is roughly 24 KB of JSON, so
`listVectors` fills a page at around 40 records where `listDocuments` reaches
the 500-row default comfortably. Both request metadata, so both need
`s3vectors:GetVectors` **in addition to** `s3vectors:ListVectors`; without it
AWS answers `403`, and the error says so.

No order is promised, because AWS documents none.

### Non-goals

Deliberately outside this library's scope, so you can plan around them rather than wait for them:

- **Segmented parallel enumeration.** `ListVectors` accepts `segmentCount`/`segmentIndex` for partitioned scans. The sequential generators above cover audit and migration; a parallel scan is a different operation with its own failure modes, and is not offered rather than half-offered.
- **Bucket lifecycle** (`CreateVectorBucket`, bucket policies, encryption defaults). The vector bucket is infrastructure — provision it with the console, CLI or IaC.
- **A retry layer of its own.** Retries are the AWS SDK's job; configure them there (see [Retries](#retries)).
- **`delete({ filter })`.** `ListVectors` takes no filter and `QueryVectors` needs a query vector and a `topK`, so any emulation would be non-atomic, racy and silently capped at 10,000 vectors. Enumerate and delete by id, where the cost and the semantics are yours to see.

### Observability

The library emits no logs by design — no `console.*` call exists anywhere in `src/`, and a unit test pins that. It stays a thin, dependency-light adapter. To instrument requests (logging, metrics, tracing), construct your own `S3VectorsClient` with the desired `logger`/middleware and pass it via the `client` option; all operations flow through it. A `client` that is not an `S3VectorsClient` is rejected with a coded `VALIDATION` error rather than silently replaced — a silent replacement would fall back to the ambient credential chain and default region, which could point the store at a different AWS account.

## 🔧 Advanced Features

### Per-Batch Embedding and Concurrent Writes

Documents are embedded one batch at a time (default: 200 docs per batch) — `embedDocuments` is never called concurrently for two batches, since most embedding providers rate-limit aggressively and this library gives no retry/backoff guarantee for that call.

Before the first batch is embedded, every document is checked — its id, its metadata, its page content — and built into the record that will be written. An input S3 Vectors cannot store is therefore refused whole, with a `VALIDATION` naming the document, having cost no embedding call and no request. `addVectors` checks its vectors the same way, across the whole call; `addDocuments` checks each batch's vectors as they come back from the model, since they do not exist sooner. The price is one small record per document for the duration of the call — a copy of its metadata, and references to its text and id — beside the documents you already hold.

Embedding and writing are **pipelined**. Once a batch is embedded, its `PutVectors` call is dispatched and the *next* batch is embedded immediately, without waiting for that put to finish — so a large ingest is bounded by embedding time, not embedding-plus-put time. At most `maxConcurrentBatchCalls` (default 10) `PutVectors` calls are in flight at once; when that window is full, embedding pauses until one settles (AWS's SDK already retries throttling on the put side). `delete()`/`getByIds()` use the same cap for `DeleteVectors`/`GetVectors`, and `addVectors` (no embedding step) dispatches its `PutVectors` calls under it too. The very first batch of any write is always embedded and sent alone, since it's the one that creates or validates the index.

Peak memory for in-flight vectors is therefore bounded by roughly `(maxConcurrentBatchCalls + 1) × batchSize` vectors — a deliberately higher ceiling than a strict one-batch-at-a-time loop, in exchange for real write throughput. Tune either knob:

```typescript
// Smaller batches, default concurrency:
await store.addDocuments(largeDocs, { batchSize: 50 });

// Strictly sequential AWS calls (share a tight account quota):
const gentle = new AmazonS3Vectors(embeddings, { ...config, maxConcurrentBatchCalls: 1 });
```

On a failure, no further batch is embedded or written; the error is thrown only after every `PutVectors` already in flight has settled, so `context.writtenIds` is complete and in document order. Because each document was checked first, such a failure comes from AWS, from an abort, from the embeddings model, or — on the first batch only, while it checks or creates the index — from a `nonFilterableMetadataKeys`/tag configuration no index could be created with, or an existing index's non-filterable keys disagreeing with this store's; never from a document that could have been refused before anything was spent.

### Rate Limits, Payload Limits and Cost

The limits this library enforces locally (failing fast with a `VALIDATION` error, before any round trip) and the ones it leaves to AWS:

| Limit | Value | Enforced |
|---|---|---|
| Vectors per `PutVectors` call (`batchSize` for `addDocuments`/`addVectors`) | ≤ 500 (default 200) | locally |
| Keys per `DeleteVectors` call (`batchSize` for `delete`) | ≤ 500 (default 500) | locally |
| Keys per `GetVectors` call (`batchSize` for `getByIds`) | ≤ 100 (default 100) | locally |
| `k` (`topK`) per query | 1 – 10,000 | locally |
| Results per `QueryVectors` page | up to 100 (paginated transparently, to a 1,000-page ceiling) | — |
| Vectors per `ListVectors` page (`pageSize`) | 1 – 1,000 (service default 500; a 1 MB page cap may return fewer) | locally |
| Vector ids | non-empty strings, unique within one write call | locally |
| Vector dimension | consistent within a batch and with the index (1 – 4,096 per AWS) | within-batch and vs. index locally; absolute range by AWS |
| Metadata keys per vector | ≤ 50, page-content key included | locally |
| Metadata value types | string, number, boolean, or an array of strings/numbers | locally |
| Filterable metadata per vector | 2,048 bytes | locally, then AWS |
| Total metadata per vector | 40,960 bytes | locally, then AWS |
| Non-filterable metadata keys per index | 10 | locally (when this library creates the index) |
| Request payload per call | AWS's per-request limit | AWS |

The metadata byte caps **are** checked locally, because the counting rule is now known rather than guessed: AWS counts the UTF-8 byte length of the JSON serialisation — key names, quotes and punctuation included — plus a fixed 5-byte overhead. That was established by binary search against the live service and recorded in [`docs/evidence/metadata-limits.md`](docs/evidence/metadata-limits.md), with a live test that fails if AWS ever changes it. A local check turns a round trip into an immediate, specific error naming the key at fault; see [Non-Filterable Metadata Keys](#non-filterable-metadata-keys) for keeping large text out of the filterable budget. Request-rate quotas are account-level and published by AWS; see [Retries](#retries) for how to behave under them.

**Cost model, briefly.** S3 Vectors bills per API request plus storage; the request count is what this library's knobs control. A write of *N* documents costs `ceil(N / batchSize)` `PutVectors` requests, plus — only with `createIndexIfNotExist` on — one `GetIndex` and possibly one `CreateIndex` per store instance lifetime, plus whatever your embeddings provider charges. A `similaritySearch` with `k > 100` costs one `QueryVectors` request per 100-result page. `getByIds`/`delete` cost `ceil(N / batchSize)` requests each. Larger `batchSize` values therefore mean fewer billable requests — the default 200 for writes is a balance between request count and the size of a failed batch to retry; raise it toward 500 for bulk backfills. `maxConcurrentBatchCalls` changes *how fast* those requests are issued, not how many. Check the [S3 Vectors pricing page](https://aws.amazon.com/s3/pricing/) for current rates.

### Non-Filterable Metadata Keys

Store large metadata values (e.g. raw HTML, full text) that don't need to be query-filterable — they're excluded from the filter index and won't count against filter-index size limits:

```typescript
const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  nonFilterableMetadataKeys: ["full_text", "raw_html"],
});
```

By default, the configured `pageContentMetadataKey` (`_page_content` unless changed) is automatically included in this list when this library creates the index — document text is exactly the kind of large value this feature exists for, and filterable metadata is capped at 2048 bytes per vector versus 40,960 bytes total. Pass your own `nonFilterableMetadataKeys` alongside it as shown above; the two lists are merged (deduplicated).

AWS caps `nonFilterableMetadataKeys` at 10 keys per index. If your own list is already at 10 and `pageContentMetadataKey` would push it to 11, index creation throws a validation error rather than silently creating the index with page content left out of the list — a `10`-and-under-with-page-content-included list would otherwise make page content *filterable* metadata (the 2048-byte cap) instead of non-filterable (40,960 bytes), with no way to fix it afterward (S3 Vectors has no way to reconfigure an existing index's metadata configuration). If you hit this, either trim your own list to 9 keys or fewer, or set `pageContentMetadataKey: null` to store page content as filterable metadata deliberately.

This configuration applies at index-creation time — it cannot be changed after the index exists.

Both caps (2048 bytes filterable, 40,960 bytes total per vector) **are** checked locally, before the `PutVectors` call. The counting rule was established by binary search against the live service and recorded in [`docs/evidence/metadata-limits.md`](docs/evidence/metadata-limits.md): AWS counts the UTF-8 byte length of the JSON serialisation plus a fixed 5-byte overhead. The filterable subset is the metadata minus the keys declared non-filterable at index creation, which this library knows because it sets them. Erring by the overhead is conservative in your favour — a payload this library accepts is one AWS accepts — and a live test fails if AWS ever changes the rule.

### Metadata Value Types

S3 Vectors stores a metadata value only if it is a string, a number, a boolean, or a **non-empty array holding only strings or only numbers**. That is stricter than the user guide's "string, number, boolean, and list types": an array holding a boolean or an object is refused, an empty array is refused, and so is an array that mixes strings with numbers. Each rejection was confirmed against the live service and recorded in [`docs/evidence/metadata-value-types.md`](docs/evidence/metadata-value-types.md).

Because the service's own rules are known rather than assumed, this library enforces them **locally**, for the whole input, before the first embedding call and the first round trip. Anything outside that set raises a `VALIDATION` error naming the document — its position in your input and its id, also on `error.context.recordIndex` and `error.context.recordId` — and the key at fault, rather than being converted, dropped or sent:

- `null` and nested objects (and arrays containing them) are rejected.
- An empty array is rejected. Omit the key instead; an empty tag list is the usual way to hit this.
- An array mixing strings with numbers is rejected. Store one type per array.
- A `Date` is rejected. Convert it yourself first — `date.toISOString()` for a string, or `date.getTime()` for a number — so the stored representation is the one you chose.
- `NaN` and `±Infinity` are rejected. The AWS SDK would send them as the strings `"NaN"` and `"Infinity"`, so a numeric filter would never match them again.
- A key whose value is `undefined` is rejected rather than quietly omitted, so a typo'd or unset field is visible instead of silently missing from the index.
- Every string — a value, an array element, a key, and the page content stored under `pageContentMetadataKey` — must be well-formed UTF-16. Text cut by UTF-16 code unit can split an emoji and leave half of it behind, and S3 Vectors fails the entire request carrying it ([`docs/evidence/string-encoding.md`](docs/evidence/string-encoding.md)). Split text with `Intl.Segmenter`, or check `text.isWellFormed()`, before writing it.

### Disabling Page-Content Round-Tripping

By default the page content is stored as `_page_content` in metadata so it can be restored on reads. Set `pageContentMetadataKey` to `null` to skip this (e.g. when you only need embeddings + metadata, not the original text):

```typescript
const store = new AmazonS3Vectors(embeddings, {
  vectorBucketName: "my-bucket",
  indexName: "my-index",
  pageContentMetadataKey: null, // documents come back with empty pageContent
});
```

If a document's own metadata already uses the reserved `pageContentMetadataKey` name, `addDocuments`/`addVectors` throws a `VALIDATION`-coded `S3VectorsError` rather than silently overwriting that field — rename the field or configure a different `pageContentMetadataKey`.

### `getByIds` and missing ids

`getByIds` returns **one slot per requested id, in order**, with `undefined` where an id is not there — the `(Document | undefined)[]` shape `@langchain/core` declares.

Every id is checked before any request: it must be a string of 1–1,024 characters and well-formed UTF-16 — the bounds `GetVectors` itself enforces. A malformed id raises `VALIDATION` naming its position (`error.context.recordIndex`) instead of failing its whole `GetVectors` batch, and every valid id in it, at AWS. A repeated id is fine: it is fetched once and fills every slot that asked for it.

Absence is an ordinary answer, not a fault: `GetVectors` returns neither an entry nor an error for a key that is not stored ([`docs/evidence/get-vectors-absent-keys.md`](docs/evidence/get-vectors-absent-keys.md)), so there is nothing to report as a failure. Keeping the slot means the result can never be silently misaligned against the id list you passed in — `result[i]` is always the answer for `ids[i]`:

```typescript
const ids = ["a", "b", "c"];
const docs = await store.getByIds(ids);
const missing = ids.filter((_id, i) => docs[i] === undefined);
```

A `GetVectors` batch that genuinely *fails* still throws, and the error's `context.foundIds` lists every id already retrieved — including by a concurrent batch that succeeded alongside the one that failed — so a retry need not start from scratch. Unknown and absent stay distinguishable.

### Deep-Copy Metadata on Duplicate-ID Fetches

Every document this store returns carries a deep copy of its metadata (via `structuredClone`), so two documents built from one response — `getByIds(["a", "a"])`, or a search result that also appears in an enumeration — never share a mutable object. Mutating one cannot change the other.

### Read-Modify-Write Upserts via `Document.id`

`addVectors`/`addDocuments` use each document's own `id` as the vector's key when `options.ids` is omitted — a fresh UUID is generated only for documents that have no `id` of their own. A document fetched via `getByIds` already has `id` set (`vector.key`), so a natural read-modify-write round-trip upserts instead of creating a duplicate:

```typescript
const [doc] = await store.getByIds(["existing-id"]);
if (doc) {
  doc.metadata.reviewed = true;
  await store.addDocuments([doc]); // overwrites "existing-id", doesn't create a new vector
}
```

An explicit `options.ids` always takes priority over `document.id` when both are present, and a fresh UUID is minted only for a document that carries no id of its own. That is what makes a read-modify-write round trip natural: the documents `getByIds` returns already carry their ids, so writing them back updates in place instead of duplicating.

### Concurrency

Multiple concurrent writers — whether separate calls on the same store instance, or entirely separate `AmazonS3Vectors` instances (different processes) — can safely race to create the same new index: whichever one loses the creation race gets a benign `ConflictException` from AWS, which this library treats as the requested state having been reached — the index exists, which is what the caller asked for. Nothing is re-read at that point: an index's configuration is fixed at creation, so the winner's settings *are* the index's settings, and the next write's `GetIndex` is where a disagreement with this store's configuration surfaces. This is verified against real AWS with more than two concurrent instances racing at once, not just two.

`deleteIndex()` running concurrently with an in-progress write is not specially handled — if the delete wins the race, the write's remaining batches are expected to fail against a since-deleted index rather than being coordinated. One ordering *is* handled, because it would otherwise resurrect the index: a delete waits for an index creation already in flight before issuing `DeleteIndex`, so the creation can never land after the delete. If your application deletes and writes to the same index concurrently, treat that write's failure as expected and handle it, rather than assuming both always succeed independently.

**An index deleted outside this process.** A store instance remembers exactly one thing about the index: that it exists. Nothing about its configuration is cached, because nothing needs to be — AWS enforces the dimension on every write, and the distance metric is checked against the `QueryVectors` response on every read, so neither can go stale. If another process (an ops script, a redeploy, a different service) deletes the index, the next `PutVectors` fails with AWS's `NotFoundException`; the store forgets that the index exists, so the *next* write re-checks and, with `createIndexIfNotExist` on, re-creates it. Exactly one write fails, and an ordinary application-level retry recovers without restarting the process.

**Destroying an index is its own method.** `delete` removes vectors by id and nothing else — that is what `delete` means in `@langchain/core`'s description of the interface ("remove stored documents by ID"), and a flag meaning "all of them" is how a production index gets destroyed by a typo. `deleteIndex()` calls `DeleteIndex`: it removes the *index*, not just its vectors. Everything attached to it goes too — its encryption configuration, tags, non-filterable-metadata configuration, and the resource any index-scoped IAM statement points at. A later write with `createIndexIfNotExist: true` re-creates the index from *this store's* configuration (`dimension` from the first vector, `distanceMetric`, `nonFilterableMetadataKeys`, `encryptionConfiguration`, `tags`), which may differ from how the original was provisioned. S3 Vectors has no "truncate" operation; if the index itself must survive, delete vectors by id instead.

```typescript
await store.delete({ ids: ["a", "b"] }); // removes two vectors
await store.deleteIndex();               // removes the index itself
```

### Cancellation (`AbortSignal`)

Every method that calls AWS accepts an `AbortSignal` — `addVectors`, `addDocuments`, `delete`, `deleteIndex`, `getByIds`, `similaritySearch*`, `maxMarginalRelevanceSearch`, `listDocuments`, `listVectors`, and the `fromTexts`/`fromDocuments` static factories:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // give up after 5s

await store.addDocuments(largeDocs, { signal: controller.signal });
```

An aborted operation rejects with a coded `S3VectorsError` (`code: "ABORTED"`), distinct from `AWS_REQUEST_FAILED`. Cancellation cancels the AWS request currently in flight (confirmed live: an abort mid-write stops the request instead of waiting for it to complete) and stops any further batches or pages from starting; a signal that's already aborted before the call even starts rejects immediately, with no network call at all — and, for the text-based search and write methods, without paying for a billable `embedQuery`/`embedDocuments` call either.

One exception: the shared index existence-check/creation calls (`GetIndex`/`CreateIndex`) triggered whenever a write needs the index checked or created — whether or not another caller happens to be racing it — are not tied to any single caller's signal, so that a concurrent sibling's write sharing that same in-flight check can never be cancelled by another caller's abort. A practical consequence: aborting mid-index-creation rejects your own call promptly, but the index may still end up created.

One signature note: all three text-based searches — `similaritySearch`, `similaritySearchWithScore` and `similaritySearchWithRelevanceScores` — take the signal as their **fifth** argument. The fourth is the `Callbacks` slot from `@langchain/core`'s `VectorStore` signature, and a signal there used to be silently discarded, letting the search run uncancelled after already spending a billable `embedQuery` call; each of them now raises a coded `VALIDATION` error naming the fifth slot instead. (`similaritySearchWithRelevanceScores` historically took the signal in the fourth position and honored it there through 0.x; since 1.0 it behaves exactly like its siblings.)

One real limitation: `embedDocuments`/`embedQuery` (from your embeddings model) have no cancellation support in LangChain's `EmbeddingsInterface`, so a batch already being embedded when the signal fires still completes — only the AWS side (and any batch not yet started) is actually cancelled.

A second one, on the retriever path, where **two different signals do two different jobs**:

| Where you pass it | Reaches | Effect |
|---|---|---|
| `asRetriever({ k, signal })` — a retriever **field** | `QueryVectors`, `GetVectors` | cancels the AWS request itself |
| `invoke(query, { signal })` — the runnable **config** | nothing downstream | the invocation rejects; the request already in flight completes |

The asymmetry is `@langchain/core`'s: `BaseRetriever.invoke(input, options)` parses the config and then calls `this._getRelevantDocuments(input, runManager)`, so the config — and therefore `config.signal` — never reaches the extension point a store subclass implements. This package closes what it can. A config signal that has **already fired** rejects before any embedding or AWS call, and one that fires mid-query rejects the invocation instead of resolving with results. To cancel the AWS request itself, put the signal on the retriever:

```typescript
const retriever = store.asRetriever({ k: 5, signal: controller.signal });
```

### Custom Retriever Configuration

```typescript
const retriever = store.asRetriever({
  k: 10,
  filter: { category: { $eq: "docs" } },
});
```

`asRetriever()` returns an `AmazonS3VectorsRetriever`: core's `VectorStoreRetriever` plus a `signal` field. Both `searchType`s core defines work — `"similarity"` (the default) and `"mmr"`, which dispatches to [Maximal Marginal Relevance](#maximal-marginal-relevance-mmr) and honours `searchKwargs: { fetchK, lambda }`:

```typescript
const diverse = store.asRetriever({
  k: 4,
  searchType: "mmr",
  searchKwargs: { fetchK: 20, lambda: 0.5 },
});
```

`"similarity_score_threshold"`, offered by some other LangChain vector stores, isn't a valid `searchType` for any store — check `scoreThreshold` support in your specific retriever's docs before relying on it.

## 📋 API Reference

### Instance Methods

| Method | Returns | Description |
|---|---|---|
| `addDocuments(docs, options?)` | `Promise<string[]>` | Embed and store documents (per-batch) |
| `addVectors(vectors, docs, options?)` | `Promise<string[]>` | Store pre-computed vectors |
| `similaritySearch(query, k?, filter?, callbacks?, signal?)` | `Promise<Document[]>` | Text query → documents |
| `similaritySearchWithScore(query, k?, filter?, callbacks?, signal?)` | `Promise<[Document, number][]>` | Text query → documents with distance |
| `similaritySearchWithRelevanceScores(query, k?, filter?, callbacks?, signal?)` | `Promise<[Document, number][]>` | Text query → documents with relevance score (higher is better) |
| `similaritySearchVectorWithScore(vector, k, filter?, signal?)` | `Promise<[Document, number][]>` | Vector query → documents with distance |
| `maxMarginalRelevanceSearch(query, options, callbacks?, signal?)` | `Promise<Document[]>` | Relevance traded against diversity (`k`, `fetchK`, `lambda`) |
| `getByIds(ids, options?)` | `Promise<(Document \| undefined)[]>` | Retrieve documents by vector id, one slot per id (see [`getByIds` and missing ids](#getbyids-and-missing-ids)) |
| `delete(params)` | `Promise<void>` | Delete vectors by id. `ids` is required; this never destroys the index |
| `deleteIndex(options?)` | `Promise<void>` | Destroy the **index** (`DeleteIndex`) — see [Concurrency](#concurrency) for what that removes |
| `listDocuments(options?)` | `AsyncGenerator<Document>` | Enumerate every document in the index (see [Enumeration](#enumeration)) |
| `listVectors(options?)` | `AsyncGenerator<{ id, vector, document }>` | Enumerate every vector with its embedding, for migration |
| `asRetriever(options?)` | `AmazonS3VectorsRetriever` | Convert to a LangChain retriever, optionally with a `signal` |

### Static Factories

| Method | Returns | Description |
|---|---|---|
| `fromTexts(texts, metadatas, embeddings, config)` | `Promise<AmazonS3Vectors>` | Create store and add texts |
| `fromDocuments(docs, embeddings, config)` | `Promise<AmazonS3Vectors>` | Create store and add documents |

### Exported Utilities

```typescript
import {
  AmazonS3Vectors,
  AmazonS3VectorsRetriever,
  cosineRelevanceScoreFn,
  // Error handling
  S3VectorsError,
  S3VectorsErrorCode,
  isS3VectorsError,
  // Types
  AmazonS3VectorsConfig,
  AmazonS3VectorsRetrieverFields,
  AmazonS3VectorsRetrieverInput,
  DistanceMetric,
  VectorDataType,
  S3VectorsDeleteParams,
  S3VectorsDeleteIndexParams,
  S3VectorsListParams,
  S3VectorsRecord,
  S3OutputVector,
  S3VectorsErrorContext,
} from "@farukada/aws-langchain-s3-vector-ts";
```

## 🔐 IAM Permissions

The store uses the following S3 Vectors actions. The IAM policy below enumerates them explicitly — no `s3vectors:*` wildcard.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3VectorsIndexLifecycle",
      "Effect": "Allow",
      "Action": [
        "s3vectors:CreateIndex",
        "s3vectors:TagResource",
        "s3vectors:GetIndex",
        "s3vectors:DeleteIndex"
      ],
      "Resource": [
        "arn:aws:s3vectors:<region>:<account-id>:bucket/<vector-bucket>",
        "arn:aws:s3vectors:<region>:<account-id>:bucket/<vector-bucket>/index/<index-name>"
      ]
    },
    {
      "Sid": "S3VectorsRead",
      "Effect": "Allow",
      "Action": [
        "s3vectors:GetVectors",
        "s3vectors:QueryVectors",
        "s3vectors:ListVectors"
      ],
      "Resource": "arn:aws:s3vectors:<region>:<account-id>:bucket/<vector-bucket>/index/<index-name>"
    },
    {
      "Sid": "S3VectorsWrite",
      "Effect": "Allow",
      "Action": [
        "s3vectors:PutVectors",
        "s3vectors:DeleteVectors"
      ],
      "Resource": "arn:aws:s3vectors:<region>:<account-id>:bucket/<vector-bucket>/index/<index-name>"
    }
  ]
}
```

**Reducing the policy further:**

- If you pre-create the index and set `createIndexIfNotExist: false`, drop the whole `S3VectorsIndexLifecycle` statement: no `GetIndex` is issued either, because nothing is checked there that AWS does not already enforce on the write itself.
- `s3vectors:TagResource` is needed **only** when you set `tags` *and* this store creates the index: AWS requires it in addition to `s3vectors:CreateIndex` to create a tagged index, and refuses the call without it. Drop it if you set no `tags`. This store never calls `TagResource` itself — tags travel inside the `CreateIndex` request — so the permission is needed without the action ever appearing on its own.
- If you never call `delete()`, remove `s3vectors:DeleteVectors`; if you never call `deleteIndex()`, remove `s3vectors:DeleteIndex`. They are separate methods and separate permissions.
- If your application is read-only (`similaritySearch*`, `getByIds`), keep only the `S3VectorsRead` statement — the read path never touches the control plane.
- If you never enumerate, remove `s3vectors:ListVectors`. If you *do* enumerate, keep `s3vectors:GetVectors` alongside it: `listDocuments` and `listVectors` both request metadata, and AWS answers a metadata or data request made without `s3vectors:GetVectors` with `403 Forbidden`.
- `maxMarginalRelevanceSearch` needs both `s3vectors:QueryVectors` and `s3vectors:GetVectors`: candidates come from the query, their embeddings from the fetch.

**A missing *bucket* is not a missing index.** `GetIndex` against a vector bucket that doesn't exist returns `NotFoundException`, the same exception as for a missing index. With `createIndexIfNotExist: true` the store therefore proceeds to `CreateIndex`, which then fails with its own `NotFoundException` naming the bucket. There is no bucket-level pre-check (`GetVectorBucket` would be one more permission and one more round trip on every cold start); if you see a `CreateIndex … NotFoundException`, check the bucket name and region first.

## 🧪 Testing

### What each tier proves

| Tier | Runs | Proves |
| --- | --- | --- |
| Unit (`npm test`) | every push, 3 OS × Node 22/24 | One test per domain cell of every contract, against a mocked `S3VectorsClient`, at 100 % coverage — plus the `VectorStore` contract suite run through `@langchain/core`'s own machinery, `fast-check` properties over whole input domains (filter validation, id resolution, batching, metadata, error normalisation), and compile-time assertions on the public types. The mocks encode AWS's *documented* responses. |
| Peer floors | every push | The lower bound of each declared peer range compiles and passes the unit tier, so the ranges in `package.json` are a promise rather than a guess. |
| Package (`npm run pack:check`, `npm run test:package-smoke`) | every push and every release | The tarball's shape (the file listing, publint, arethetypeswrong), and that the installed package works from ESM, CommonJS and a TypeScript 5 consumer with `skipLibCheck` off. |
| Live AWS (`npm run test:integration`) | on demand, locally, against an ephemeral bucket | The real service behaves as the mocks assume: index lifecycle, writes, reads, filters, pagination, enumeration, MMR and the error shapes this library branches on. It also re-checks every undocumented behaviour recorded in [`docs/evidence/`](docs/evidence/) — the metadata byte-counting rule, the cosine-distance formula, what `GetVectors` does with absent keys — so a change on AWS's side fails a test rather than going unnoticed. |
| Verification scripts (`npm run verify`) | on demand | The whole public API end to end, with real Bedrock embeddings. |

**Coverage is not the evidence.** 100 % means no line is unexercised; it does not mean a behaviour was decided. What backs the suite is the executable contract registry under [`test/contract/registry/`](test/contract/registry/): every public entry point is declared as data — the errors it may raise, the context each one carries, the AWS calls it makes and in what order — and the conformance runner drives each declaration against a two-axis hostile corpus, 32 input values across 13 ambient conditions. Six properties are asserted over the result: that nothing escapes outside the declared set, that an input outside the accepted domain is refused before any AWS call or billable embedding, that every declared code is reachable, that each carries the context it promises, that the effects are the declared ones, and that the registry covers the whole public surface. A contract the code breaks fails a run; so does a recorded exception the code has stopped breaking, which is what keeps the ledger from going stale. Nine service behaviours AWS does not document are recorded under [`docs/evidence/`](docs/evidence/) with their raw traffic, each paired with a live test.

The gap this closes is a specific one: the contracts were written, reviewed and linted for a release, and never executed. A syntactic gate read them as text and could not tell a true clause from a false one.

What nothing proves: throughput under a shared account quota, behaviour at AWS's absolute limits (a 20 MiB request, a 10,000-result search) beyond what the live suite samples, and any S3 Vectors behaviour AWS changes between two live runs. There is no S3 Vectors emulator, so every check that is not the live suite trusts the documented contract.

### Unit tests

```bash
npm test            # Run all unit tests with coverage
npm run test:watch  # Watch mode
```

Unit tests use [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock) — the library [AWS officially recommends](https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3-in-unit-tests/) for SDK v3 — to mock `S3VectorsClient` without network calls. Coverage thresholds: **100% branches / 100% functions / 100% lines / 100% statements**, enforced in CI.

### Integration tests (live AWS)

> **LocalStack does not currently support the `s3vectors` service** ([localstack/localstack#13498](https://github.com/localstack/localstack/issues/13498)). Integration tests run against real AWS and are gated off by default.

**Local run:**

```bash
export RUN_LIVE_INTEGRATION=1
export AWS_VECTOR_BUCKET=<your-pre-created-vector-bucket>
export AWS_REGION=us-east-1
# Plus AWS credentials (AWS_PROFILE or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)

npm run test:integration
```

Without `RUN_LIVE_INTEGRATION=1` **and** `AWS_VECTOR_BUCKET` set, the suite prints a skip message and exits 0 — no false passes, no false fails.

**There is no CI job for this tier.** The live suite runs locally, on demand, against a bucket you create and delete for the run. A scheduled workflow spent real money on every night the repository was untouched and reported against whatever `main` happened to be, which is not the commit anyone was looking at; it is removed rather than left to run unread. Everything it enforced still holds when you run the suite yourself: `RUN_LIVE_INTEGRATION=1` with no `AWS_VECTOR_BUCKET` is fatal rather than a silent skip, so a half-set environment cannot report success having run nothing.

### Verifying against real AWS

Standalone verification scripts in [`examples/`](examples/) exercise the full public API against live Amazon S3 Vectors using real [Amazon Bedrock](https://aws.amazon.com/bedrock/) embeddings (Amazon Titan Text Embeddings V2, `amazon.titan-embed-text-v2:0`). Each script provisions a unique `verify-*` index, runs its checks, prints a `PASS/FAIL` summary, tears its index down, and exits non-zero on any failure.

You need an existing S3 vector bucket and Bedrock model access to Titan Text Embeddings V2 in your region.

```bash
export AWS_VECTOR_BUCKET=<your-pre-created-vector-bucket>
export AWS_REGION=us-east-1
# Plus AWS credentials (AWS_PROFILE or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)

npm run verify          # build + core, search, and edge-case scripts
# or individually:
npm run verify:core     # CRUD, index lifecycle, fromTexts/fromDocuments, queryEmbeddings, retry config
npm run verify:search   # search surface, cosine/euclidean, full filter-operator matrix, asRetriever
npm run verify:edge     # null page-content key, raw vectors, duplicate ids, nonFilterable keys,
                        # typed error codes, and 200/100/500 batch boundaries
```

`@langchain/aws` (which provides the Bedrock embeddings) is a **devDependency only** — it is used by the verification scripts and never ships in the published package.

### Type-checking, lint, build

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint (read-only)
npm run lint:fix    # ESLint with --fix
npm run build       # Compile src/ to dist/esm (ESM) and dist/cjs (CommonJS)
npm run pack:check  # Tarball listing guard, then publint + arethetypeswrong (needs a build)
npm run docs        # Regenerate TypeDoc output
npm run check:docs  # Type-check every TypeScript sample in the documentation
```

## 📁 Project Structure

```
src/
├── index.ts                      # Public API — class, retriever, error types, utilities
├── s3-vectors.ts                 # AmazonS3Vectors — the VectorStore itself
├── retriever.ts                  # AmazonS3VectorsRetriever (the signal-aware retriever)
├── relevance-scores.ts           # cosineRelevanceScoreFn
├── types.ts                      # Config + output types
├── actions/                      # One operation each, built on internal/
│   ├── add.ts                    # addVectors / addDocuments
│   ├── search.ts                 # searchByVector, selectRelevanceScoreFn
│   ├── mmr.ts                    # maximalMarginalRelevance over query + fetch
│   ├── get-by-ids.ts             # getByIds
│   ├── delete.ts                 # delete by id (destroying the index is its own path)
│   └── list.ts                   # listDocuments / listVectors
├── internal/                     # Request-shaped helpers (not re-exported)
│   ├── index-lifecycle.ts        # describe / create / delete, with the shared creation memo
│   ├── put-batch.ts              # One validated PutVectors batch; sendAws
│   ├── embed-pipeline.ts         # Sequential embedding pipelined against writes
│   ├── concurrency.ts            # First batch alone, then bounded groups
│   ├── query-pages.ts            # QueryVectors pagination to k
│   ├── list-pages.ts             # ListVectors pagination, as an async generator
│   ├── get-vectors.ts            # Batched GetVectors by key
│   ├── ids.ts / limits.ts        # Write-id resolution; dimension and value checks
│   ├── output-vectors.ts         # Reads the vector list off an AWS response, or fails
│   ├── guards.ts                 # Caller-input checks shared by the entry points
│   ├── filter.ts                 # Filter vocabulary validation
│   ├── operation.ts              # The request fields every action shares
│   └── signals.ts                # checkAborted / raceAbort
├── shared/                       # Pure helpers (not re-exported)
│   ├── stub-embeddings.ts        # StubEmbeddings placeholder for raw-vector workflows
│   ├── validation.ts             # assertValidConfig, assertValidIndexConfig
│   ├── metadata.ts               # buildPutMetadata, createDocument (pure functions)
│   ├── batching.ts               # chunk, offsetBatches (pure functions)
│   ├── describe.ts               # Describes a rejected value by kind, never by content
│   ├── objects.ts                # isObjectLike / isPlainObject — the two object checks, once
│   ├── aws-limits.ts             # Every AWS limit enforced in more than one place, stated once
│   └── errors/                   # Typed error model
│       ├── s3-vectors-error.ts   # S3VectorsError + isS3VectorsError guard
│       ├── error-code.ts         # S3VectorsErrorCode enum
│       ├── classify.ts           # AWS exception name → error class
│       ├── decorate.ts           # Partial-progress ids and the factory instance
│       ├── wrap-error.ts         # wrapAwsError / toError
│       ├── aws-not-found.ts      # isAwsNotFoundException guard
│       ├── aws-conflict.ts       # isAwsConflictException guard
│       └── aws-abort.ts          # isAbortError guard
└── guide.md                      # In-depth usage guide

test/                             # Unit (100% coverage), contract, property, types
├── helpers.ts                    # aws-sdk-client-mock factories
├── *.test.ts                     # Per-method unit suites (add/query/delete/get/errors…)
├── shared/                       # Mirrors src/shared (incl. errors/, validation)
├── internal/                     # Mirrors src/internal, one suite per contract
├── actions/                      # Mirrors src/actions
├── contract/                     # The executable contract registry and its conformance run, plus the VectorStore and MMR suites run through core and the doc-truth gates
├── property/                     # fast-check invariants over whole input domains
├── types/                        # Compile-time public-API assertions
├── package-smoke/                # Pack, install, then import / require / type-check the tarball (node --test)
└── integration/                  # Live-AWS integration tests (env-gated)

scripts/
├── pack-check.mjs                # Tarball listing guard; `npm run pack:check` adds publint + arethetypeswrong
└── check-doc-samples.mjs         # Compiles every TypeScript sample in README.md, src/guide.md and CHANGELOG.md

examples/                         # Standalone real-AWS verification scripts (.mjs)
├── _harness.mjs / _embeddings.mjs
└── verify-core / verify-search / verify-edge-cases

.github/workflows/
├── ci.yml                        # CI on push/PR to main (3 OS × Node 22/24, peer floors, package checks, hygiene)
├── codeql.yml                    # Static analysis on push/PR to main + weekly
├── dependency-review.yml         # Fails a PR introducing a high-severity+ vulnerable dependency
├── scorecard.yml                 # OpenSSF Scorecard, published weekly + on push to main
└── release.yml                   # Tag-triggered publish via npm Trusted Publishing, gated on green CI (+ SBOM); `-rc` tags go to `next`

docs/                             # TypeDoc-generated API docs (checked in)
└── evidence/                     # Live-AWS probes for behaviour AWS does not document
dist/                             # Build output (gitignored): esm/ and cjs/ trees from the same source
```

## 🤝 Contributing

Contributions are welcome — please open an issue to discuss non-trivial changes before submitting a PR. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local development setup, coding standards, and PR expectations, and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for community expectations. [`SUPPORT.md`](./SUPPORT.md) says how to get help.

Found a security issue? See [`SECURITY.md`](./SECURITY.md) instead of opening a public issue.

## 📄 License

[MIT](./LICENSE) © Faruk Ada.
