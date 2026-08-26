import { randomUUID } from 'node:crypto';

import {
  S3VectorsClient,
  CreateIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
  DeleteVectorsCommand,
  DeleteIndexCommand,
  GetVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore } from '@langchain/core/vectorstores';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
import { chunk } from './shared/batching.js';
import { isAwsConflictException } from './shared/errors/aws-conflict.js';
import { isAwsNotFoundException } from './shared/errors/aws-not-found.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { wrapAwsError } from './shared/errors/wrap-error.js';
import { buildPutMetadata, createDocument } from './shared/metadata.js';
import { isStubEmbeddings, StubEmbeddings } from './shared/stub-embeddings.js';
import { assertValidIndexConfig } from './shared/validation.js';
import type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  S3OutputVector,
  S3VectorsDeleteParams,
  VectorDataType,
} from './types.js';

/** Default batch sizes matching the Python implementation. */
const DEFAULT_PUT_BATCH_SIZE = 200;
const DEFAULT_DELETE_BATCH_SIZE = 500;
const DEFAULT_GET_BATCH_SIZE = 100;
/**
 * Per-call ceilings enforced by AWS itself (confirmed live: exceeding these
 * fails with a `ValidationException` naming the same limit). Checked
 * locally so an oversized `batchSize` fails fast with a clear message
 * instead of an AWS round trip.
 */
const MAX_PUT_BATCH_SIZE = 500;
const MAX_DELETE_BATCH_SIZE = 500;
const MAX_GET_BATCH_SIZE = 100;
/** Max number of batch AWS calls (DeleteVectors/GetVectors) in flight at once. */
const MAX_CONCURRENT_BATCH_CALLS = 10;

/**
 * Max `QueryVectors` pages per search — defense-in-depth against a
 * response that keeps returning `nextToken` without ever satisfying `k`.
 * AWS's page size is fixed (confirmed live: `topK` of 101, 1,000, and
 * 10,000 each still return exactly 100 vectors per page — it isn't a
 * caller-tunable or query-content-dependent value), and `topK` itself
 * caps at 10,000, so 100 pages (10,000 / 100) is the most any legitimate
 * search could ever need. This only stops a response that never converges.
 */
const MAX_QUERY_PAGES = 100;

/** AWS's own ceiling for `topK` (confirmed live: `QueryVectors` rejects anything above this). */
const MAX_TOP_K = 10_000;

/** Default metadata key to store page_content in. */
const DEFAULT_PAGE_CONTENT_KEY = '_page_content';

/**
 * LangChain vector store backed by **Amazon S3 Vectors**.
 *
 * Provides persistent vector storage, similarity search, and metadata filtering
 * using the native AWS S3 Vectors service.
 *
 * @remarks
 * Requires an existing S3 vector bucket (created manually via the AWS
 * console or CLI). The vector index inside the bucket is created
 * automatically on the first write when {@link AmazonS3VectorsConfig.createIndexIfNotExist}
 * is `true` (the default).
 *
 * Documents are embedded per batch to keep peak memory usage low for
 * large document sets, matching the Python `langchain-aws` implementation.
 *
 * Throttling and transient (5xx) failures are retried automatically by the
 * AWS SDK; tune this via the `maxAttempts` and `retryMode` config options.
 *
 * Maximal Marginal Relevance (`maxMarginalRelevanceSearch`) is intentionally
 * not implemented, matching the Python `langchain-aws` reference — use metadata
 * pre-filtering or client-side re-ranking if you need diversity.
 *
 * @example
 * ```ts
 * import { AmazonS3Vectors } from "@farukada/aws-langchain-s3-vector-ts";
 * import { BedrockEmbeddings } from "@langchain/aws";
 *
 * const store = new AmazonS3Vectors(new BedrockEmbeddings(), {
 *   vectorBucketName: "my-vector-bucket",
 *   indexName: "my-index",
 *   region: "us-east-1",
 * });
 *
 * await store.addDocuments([
 *   new Document({ pageContent: "Star Wars", metadata: { genre: "scifi" } }),
 * ]);
 *
 * const results = await store.similaritySearch("space adventure", 4);
 * ```
 */
export class AmazonS3Vectors extends VectorStore {
  /** @internal discriminator used by LangChain */
  declare FilterType: Record<string, unknown>;

  // ── Config ────────────────────────────────────────────────────────────

  readonly vectorBucketName: string;
  readonly indexName: string;
  readonly dataType: VectorDataType;
  readonly distanceMetric: DistanceMetric;
  readonly nonFilterableMetadataKeys: string[] | undefined;
  readonly pageContentMetadataKey: string | null;
  readonly createIndexIfNotExist: boolean;

  private readonly _relevanceScoreFn: ((distance: number) => number) | undefined;
  private readonly _queryEmbeddings: EmbeddingsInterface | undefined;
  private readonly _client: S3VectorsClient;
  private _ensureIndexPromise: Promise<{
    dimension: number;
    distanceMetric: DistanceMetric;
  } | null> | null = null;
  /**
   * Cached result of the one-time `GetIndex` fetch performed under
   * `createIndexIfNotExist: false` to validate against — that flag means
   * "the caller manages the index lifecycle, don't check on every write,"
   * so this is fetched once and reused, not memoized per-call like
   * {@link _ensureIndexPromise}. Cleared by {@link delete} when the whole
   * index is deleted, so a later write re-fetches instead of validating
   * against a now-stale index.
   */
  private _validatedIndexInfo: { dimension: number; distanceMetric: DistanceMetric } | null = null;

  // ── Constructor ───────────────────────────────────────────────────────

  /**
   * Create a new Amazon S3 Vectors store
   *
   * @param embeddings - Embedding model for indexing and querying, or `undefined` for raw-vector workflows
   * @param config - Configuration options for the store
   * @param config.vectorBucketName - Name of an existing S3 vector bucket
   * @param config.indexName - Name of the vector index (3–63 chars)
   * @param config.client - Optional pre-configured S3VectorsClient (takes precedence over region/credentials)
   * @param config.region - AWS region (ignored when `client` is set)
   * @param config.credentials - AWS credentials (ignored when `client` is set)
   * @param config.distanceMetric - Distance metric: `"cosine"` (default) or `"euclidean"`
   * @param config.createIndexIfNotExist - Auto-create index on first write (default: `true`)
   * @param config.queryEmbeddings - Separate embedding model for queries only
   * @param config.nonFilterableMetadataKeys - Metadata keys excluded from query filters
   * @param config.maxAttempts - Max attempts (initial + retries) for AWS requests (ignored when `client` is set)
   * @param config.retryMode - AWS SDK retry mode: `"standard"` | `"adaptive"` | `"legacy"` (ignored when `client` is set)
   */
  constructor(embeddings: EmbeddingsInterface | undefined, config: AmazonS3VectorsConfig) {
    super(embeddings ?? config.embeddings ?? new StubEmbeddings(), config);

    this.vectorBucketName = config.vectorBucketName;
    this.indexName = config.indexName;
    assertValidIndexConfig(this.vectorBucketName, this.indexName);
    this.dataType = config.dataType ?? 'float32';
    this.distanceMetric = config.distanceMetric ?? 'cosine';
    this.nonFilterableMetadataKeys = config.nonFilterableMetadataKeys;
    this.pageContentMetadataKey =
      config.pageContentMetadataKey === undefined
        ? DEFAULT_PAGE_CONTENT_KEY
        : config.pageContentMetadataKey;
    this.createIndexIfNotExist = config.createIndexIfNotExist ?? true;
    this._relevanceScoreFn = config.relevanceScoreFn;
    this._queryEmbeddings = config.queryEmbeddings;

    if (config.client && typeof config.client.send === 'function') {
      this._client = config.client;
    } else {
      this._client = new S3VectorsClient({
        region: config.region,
        credentials: config.credentials,
        endpoint: config.endpoint,
        maxAttempts: config.maxAttempts,
        retryMode: config.retryMode,
      });
    }
  }

  // ── Getters ───────────────────────────────────────────────────────────

  _vectorstoreType(): string {
    return 'amazonS3Vectors';
  }

  // ── Required abstract implementations ─────────────────────────────────

  /**
   * Add pre-computed vectors alongside their documents to the store.
   *
   * @remarks
   * Vectors are batched in groups of 200 (default) and sent
   * via `PutVectorsCommand`. On the first call the index is auto-created
   * if it does not already exist and `createIndexIfNotExist` is `true`.
   *
   * @param vectors - Array of embedding vectors (one per document)
   * @param documents - Array of documents corresponding to each vector
   * @param options - Optional settings
   * @param options.ids - Custom IDs for each vector (auto-generated if omitted)
   * @param options.batchSize - Number of vectors per `PutVectors` call (default: 200)
   * @returns The IDs assigned to each stored vector
   * @throws Error if counts of vectors, documents, or IDs don't match
   */
  async addVectors(
    vectors: number[][],
    documents: Document[],
    options?: { ids?: string[]; batchSize?: number },
  ): Promise<string[]> {
    if (vectors.length !== documents.length) {
      throw this._validationError(
        'addVectors',
        `Number of vectors (${vectors.length}) must match number of documents (${documents.length})`,
      );
    }
    // Checked before the empty-batch short-circuit below — a caller passing
    // a stale/mismatched `ids` array alongside an empty `vectors` array is
    // still a real caller mistake and shouldn't be silently swallowed into
    // a no-op success.
    const ids = options?.ids ?? vectors.map(() => randomUUID().replace(/-/g, ''));
    if (ids.length !== vectors.length) {
      throw this._validationError(
        'addVectors',
        `Number of IDs (${ids.length}) must match number of vectors (${vectors.length})`,
      );
    }
    if (vectors.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addVectors', batchSize, MAX_PUT_BATCH_SIZE);

    let offset = 0;
    for (const slice of chunk(vectors, batchSize)) {
      await this._ensureIndexAndPut(
        'addVectors',
        offset,
        slice,
        documents.slice(offset, offset + slice.length),
        ids.slice(offset, offset + slice.length),
      );
      offset += slice.length;
    }

    return ids;
  }

  /**
   * Embed documents and store them in the vector index.
   *
   * @remarks
   * Documents are embedded **per batch** to keep peak memory usage low
   * for large document sets (matching the Python `langchain-aws` implementation).
   *
   * @param documents - Array of documents to embed and store
   * @param options - Optional settings
   * @param options.ids - Custom IDs for each vector (auto-generated if omitted)
   * @param options.batchSize - Number of documents per embedding + put batch (default: 200)
   * @returns The IDs assigned to each stored vector
   * @throws Error if count of IDs doesn't match count of documents
   */
  async addDocuments(
    documents: Document[],
    options?: { ids?: string[]; batchSize?: number },
  ): Promise<string[]> {
    // Checked before the empty-batch short-circuit below — a caller passing
    // a stale/mismatched `ids` array alongside an empty `documents` array is
    // still a real caller mistake and shouldn't be silently swallowed into
    // a no-op success.
    const ids = options?.ids ?? documents.map(() => randomUUID().replace(/-/g, ''));
    if (ids.length !== documents.length) {
      throw this._validationError(
        'addDocuments',
        `Number of IDs (${ids.length}) must match number of documents (${documents.length})`,
      );
    }
    if (documents.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addDocuments', batchSize, MAX_PUT_BATCH_SIZE);

    const embeddings = this._getIndexEmbeddings();
    let offset = 0;
    for (const batchDocs of chunk(documents, batchSize)) {
      const batchTexts = batchDocs.map((d) => d.pageContent);
      const batchVectors = await embeddings.embedDocuments(batchTexts);

      // An embeddings model that drops or adds entries (e.g. one that
      // silently skips empty strings) would otherwise re-pair a vector with
      // the wrong document/id below, via the shared index-based zip in
      // _ensureIndexAndPut — addVectors already guards this exact invariant
      // for caller-supplied vectors; this is the same guard for the
      // embeddings-model-supplied case.
      if (batchVectors.length !== batchDocs.length) {
        throw this._validationError(
          'addDocuments',
          `Embeddings model returned ${batchVectors.length} vectors for ${batchDocs.length} documents — it must return exactly one vector per document.`,
        );
      }

      await this._ensureIndexAndPut(
        'addDocuments',
        offset,
        batchVectors,
        batchDocs,
        ids.slice(offset, offset + batchDocs.length),
      );
      offset += batchDocs.length;
    }

    return ids;
  }

  /**
   * Add texts (with optional metadata) to the vector store.
   *
   * @remarks
   * Convenience method that wraps each text/metadata pair into a
   * {@link Document} and delegates to {@link addDocuments}.
   *
   * @param texts - Array of text strings to embed and store
   * @param metadatas - Optional array of metadata objects (one per text)
   * @param options - Optional settings
   * @param options.ids - Custom IDs for each vector (auto-generated if omitted)
   * @param options.batchSize - Number of documents per batch (default: 200)
   * @returns The IDs assigned to each stored vector
   * @throws Error if count of metadatas doesn't match count of texts
   */
  async addTexts(
    texts: string[],
    metadatas?: Record<string, unknown>[],
    options?: { ids?: string[]; batchSize?: number },
  ): Promise<string[]> {
    if (metadatas && metadatas.length !== texts.length) {
      throw this._validationError(
        'addTexts',
        `Number of metadatas (${metadatas.length}) must match number of texts (${texts.length})`,
      );
    }
    const docs = texts.map(
      (text, i) => new Document({ pageContent: text, metadata: metadatas?.[i] ?? {} }),
    );
    return this.addDocuments(docs, options);
  }

  /**
   * Core similarity search returning `[Document, distance]` tuples.
   *
   * @remarks
   * This is the abstract method required by LangChain's `VectorStore`.
   * The score is the raw distance returned by S3 Vectors — lower means
   * more similar for both cosine and euclidean metrics.
   *
   * @param query - Embedding vector to search against
   * @param k - Number of results to return
   * @param filter - Optional metadata filter (S3 Vectors filter syntax)
   * @returns Array of `[Document, distance]` tuples, ordered by similarity
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType'],
  ): Promise<[Document, number][]> {
    const outputVectors = await this._queryVectors('similaritySearchVectorWithScore', k, {
      queryVector: { float32: query },
      filter: filter as __DocumentType | undefined,
      returnMetadata: true,
      returnDistance: true,
    });

    return outputVectors.map((v) => [
      createDocument(v, this.pageContentMetadataKey),
      v.distance ?? 0,
    ]);
  }

  // ── Additional public API (parity with Python) ────────────────────────

  /**
   * Run a text-based similarity search and return documents with scores.
   *
   * The query string is embedded using the query-embedding model, then
   * {@link similaritySearchVectorWithScore} is called.
   *
   * @remarks
   * Validates `k` before embedding — an invalid `k` shouldn't cost a
   * billable `embedQuery` call before failing.
   */
  async similaritySearchWithScore(
    query: string,
    k = 4,
    filter?: this['FilterType'],
  ): Promise<[Document, number][]> {
    this._validateK('similaritySearchWithScore', k);
    const queryVector = await this._getQueryEmbeddings().embedQuery(query);
    return this.similaritySearchVectorWithScore(queryVector, k, filter);
  }

  /**
   * Run a text-based similarity search and return documents (no scores).
   *
   * @remarks
   * Overrides `VectorStore`'s default implementation, which embeds the
   * query with the indexing embedding model. This override routes through
   * {@link similaritySearchWithScore}, so a configured `queryEmbeddings`
   * model is used for the query, matching `asRetriever()`'s behavior.
   */
  async similaritySearch(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: Callbacks,
  ): Promise<Document[]> {
    return (await this.similaritySearchWithScore(query, k, filter)).map(([doc]) => doc);
  }

  /**
   * Return documents most similar to a raw embedding vector (no scores).
   */
  async similaritySearchByVector(
    embedding: number[],
    k = 4,
    filter?: this['FilterType'],
  ): Promise<Document[]> {
    const outputVectors = await this._queryVectors('similaritySearchByVector', k, {
      queryVector: { float32: embedding },
      filter: filter as __DocumentType | undefined,
      returnMetadata: true,
      returnDistance: false,
    });

    return outputVectors.map((v) => createDocument(v, this.pageContentMetadataKey));
  }

  /**
   * Run a text-based similarity search and return documents with
   * *relevance scores* (higher is better), converted from S3 Vectors'
   * raw distance via {@link _selectRelevanceScoreFn}.
   */
  async similaritySearchWithRelevanceScores(
    query: string,
    k = 4,
    filter?: this['FilterType'],
  ): Promise<[Document, number][]> {
    const scoreFn = this._selectRelevanceScoreFn();
    const results = await this.similaritySearchWithScore(query, k, filter);
    return results.map(([doc, distance]) => [doc, scoreFn(distance)]);
  }

  /**
   * Delete vectors by ID, or delete the entire index.
   *
   * @param params - Deletion parameters
   * @param params.ids - Vector IDs to delete
   * @param params.batchSize - Number of IDs per `DeleteVectors` call (default: 500)
   * @param params.deleteAll - Must be `true` (with `ids` omitted) to delete the entire index
   * @throws Error if both `ids` and `deleteAll` are omitted — a safety guard against an
   * accidentally-`undefined` `ids` array silently wiping the whole index — or if both `ids`
   * and `deleteAll` are passed together
   */
  async delete(params?: S3VectorsDeleteParams): Promise<void> {
    const ids = params?.ids;
    const deleteAll = params?.deleteAll === true;

    // Both validation checks up front, flat — everything below this point
    // is action dispatch, not validation.
    if (ids !== undefined && deleteAll) {
      throw this._validationError(
        'delete',
        'delete() cannot take both `ids` and `deleteAll: true` — pass one or the other.',
      );
    }
    if (ids === undefined && !deleteAll) {
      throw this._validationError(
        'delete',
        'delete() with no `ids` would delete the entire index. Pass `{ deleteAll: true }` ' +
          'to confirm, or pass `ids` to delete specific vectors.',
      );
    }

    if (ids === undefined) {
      await this._send('DeleteIndex', () =>
        this._client.send(
          new DeleteIndexCommand({
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
          }),
        ),
      );
      // The index no longer exists — a cached compatibility check against
      // it would validate a later write against a now-deleted index.
      this._validatedIndexInfo = null;
    } else {
      const batchSize = params?.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
      this._validateBatchSize('delete', batchSize, MAX_DELETE_BATCH_SIZE);
      for (const group of chunk(chunk(ids, batchSize), MAX_CONCURRENT_BATCH_CALLS)) {
        await Promise.all(
          group.map((batchIds) =>
            this._send('DeleteVectors', () =>
              this._client.send(
                new DeleteVectorsCommand({
                  vectorBucketName: this.vectorBucketName,
                  indexName: this.indexName,
                  keys: batchIds,
                }),
              ),
            ),
          ),
        );
      }
    }
  }

  /**
   * Retrieve documents by their vector IDs.
   *
   * @remarks
   * The order of the returned documents matches the order of the input IDs.
   * When duplicate IDs are present, metadata is deep-copied (via `structuredClone`)
   * to prevent shared-reference mutations between returned documents.
   *
   * @param ids - Array of vector IDs to retrieve
   * @param options - Optional settings
   * @param options.batchSize - Number of IDs per `GetVectors` call (default: 100)
   * @returns Array of documents in the same order as the input IDs
   * @throws Error if any ID is not found in the vector store
   */
  async getByIds(ids: string[], options?: { batchSize?: number }): Promise<Document[]> {
    const batchSize = options?.batchSize ?? DEFAULT_GET_BATCH_SIZE;
    this._validateBatchSize('getByIds', batchSize, MAX_GET_BATCH_SIZE);
    const batches = chunk(ids, batchSize);

    // Bound the number of in-flight GetVectors calls: process batches in
    // groups, running each group concurrently but awaiting it before
    // starting the next. Order is preserved — groups run in sequence, and
    // within a group `Promise.all` resolves in the same order as `.map`.
    const docs: Document[] = [];
    for (const group of chunk(batches, MAX_CONCURRENT_BATCH_CALLS)) {
      const groupResponses = await Promise.all(
        group.map((batchIds) =>
          this._send('GetVectors', () =>
            this._client.send(
              new GetVectorsCommand({
                vectorBucketName: this.vectorBucketName,
                indexName: this.indexName,
                keys: batchIds,
                returnData: false,
                returnMetadata: true,
              }),
            ),
          ),
        ),
      );

      for (let i = 0; i < group.length; i++) {
        const batchIds = group[i]!;
        const outputVectors = (groupResponses[i]!.vectors ?? []) as S3OutputVector[];
        const vectorMap = new Map<string, S3OutputVector>();
        for (const v of outputVectors) {
          vectorMap.set(v.key, v);
        }

        // When duplicate IDs are present, deep-copy metadata to prevent
        // shared-reference mutations (matches Python behaviour).
        const hasDuplicateIds = vectorMap.size < batchIds.length;

        // Preserve input order and verify all IDs were found.
        for (const id of batchIds) {
          const v = vectorMap.get(id);
          if (!v) {
            throw new S3VectorsError(
              `Id '${id}' not found in vector store.`,
              S3VectorsErrorCode.NOT_FOUND,
              {
                operation: 'getByIds',
                vectorBucketName: this.vectorBucketName,
                indexName: this.indexName,
              },
            );
          }
          docs.push(createDocument(v, this.pageContentMetadataKey, hasDuplicateIds));
        }
      }
    }

    return docs;
  }

  /**
   * Static factory: create an {@link AmazonS3Vectors} instance, embed
   * the given texts, and add them to the store.
   */
  static async fromTexts(
    texts: string[],
    metadatas: Record<string, unknown>[] | Record<string, unknown>,
    embeddings: EmbeddingsInterface,
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number },
  ): Promise<AmazonS3Vectors> {
    if (Array.isArray(metadatas) && metadatas.length !== texts.length) {
      throw new S3VectorsError(
        `Number of metadatas (${metadatas.length}) must match number of texts (${texts.length})`,
        S3VectorsErrorCode.VALIDATION,
        { operation: 'fromTexts' },
      );
    }

    const metaArray = Array.isArray(metadatas) ? metadatas : texts.map(() => metadatas);

    const documents = texts.map(
      (text, i) => new Document({ pageContent: text, metadata: metaArray[i]! }),
    );

    return AmazonS3Vectors.fromDocuments(documents, embeddings, config);
  }

  /**
   * Static factory: create an {@link AmazonS3Vectors} instance and add
   * the given documents to the store.
   */
  static async fromDocuments(
    docs: Document[],
    embeddings: EmbeddingsInterface,
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number },
  ): Promise<AmazonS3Vectors> {
    const instance = new AmazonS3Vectors(embeddings, config);
    await instance.addDocuments(docs, { ids: config.ids, batchSize: config.batchSize });
    return instance;
  }

  // ── Protected / internal helpers ──────────────────────────────────────

  /** @internal Select the correct relevance-score function. */
  _selectRelevanceScoreFn(): (distance: number) => number {
    if (this._relevanceScoreFn) return this._relevanceScoreFn;

    if (this.distanceMetric === 'euclidean') {
      return euclideanRelevanceScoreFn;
    }
    return cosineRelevanceScoreFn;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** Return the query-embedding model, falling back to the indexing model. */
  private _getQueryEmbeddings(): EmbeddingsInterface {
    const emb = this._queryEmbeddings ?? this.embeddings;
    if (isStubEmbeddings(emb)) {
      throw new S3VectorsError(
        'No embedding model available for queries. ' +
          'Provide `embeddings` or `queryEmbeddings` in the config.',
        S3VectorsErrorCode.EMBEDDINGS_MISSING,
        { operation: 'query', vectorBucketName: this.vectorBucketName, indexName: this.indexName },
      );
    }
    return emb;
  }

  /** Return the indexing-embedding model, throwing a coded error if none is configured. */
  private _getIndexEmbeddings(): EmbeddingsInterface {
    if (isStubEmbeddings(this.embeddings)) {
      throw new S3VectorsError(
        'No embedding model configured for indexing. Provide `embeddings` in the config.',
        S3VectorsErrorCode.EMBEDDINGS_MISSING,
        {
          operation: 'addDocuments',
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        },
      );
    }
    return this.embeddings;
  }

  /** Build a {@link S3VectorsError} for a caller-input validation failure. */
  private _validationError(operation: string, message: string): S3VectorsError {
    return new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
      operation,
      vectorBucketName: this.vectorBucketName,
      indexName: this.indexName,
    });
  }

  /**
   * Reject a non-positive batchSize before it can drive an infinite loop,
   * and one that exceeds AWS's own per-call limit for this operation
   * before spending a round trip to discover the same thing from AWS.
   */
  private _validateBatchSize(operation: string, batchSize: number, max: number): void {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw this._validationError(operation, 'batchSize must be a positive integer');
    }
    if (batchSize > max) {
      throw this._validationError(
        operation,
        `batchSize (${batchSize}) exceeds AWS's limit of ${max} per call for this operation.`,
      );
    }
  }

  /**
   * Reject a non-positive k before it can drive excessive QueryVectors
   * pagination, and one above AWS's own `topK` ceiling before spending a
   * round trip to discover the same thing from AWS.
   */
  private _validateK(operation: string, k: number): void {
    if (!Number.isInteger(k) || k <= 0) {
      throw this._validationError(operation, 'k must be a positive integer');
    }
    if (k > MAX_TOP_K) {
      throw this._validationError(operation, `k (${k}) exceeds AWS's topK limit of ${MAX_TOP_K}.`);
    }
  }

  /**
   * Reject an empty filter object before it reaches AWS. Confirmed live:
   * S3 Vectors rejects `{}` with an opaque "Invalid filter"
   * `ValidationException` rather than treating it as "no filter" — a
   * caller building a filter dynamically (e.g. only adding conditions when
   * a UI field is set) can easily end up passing `{}` by accident when no
   * condition ends up applying. Omit the `filter` argument entirely
   * (`undefined`) to search without filtering.
   */
  private _validateFilter(operation: string, filter: __DocumentType | undefined): void {
    if (
      filter !== undefined &&
      typeof filter === 'object' &&
      filter !== null &&
      !Array.isArray(filter) &&
      Object.keys(filter).length === 0
    ) {
      throw this._validationError(
        operation,
        'filter cannot be an empty object ({}) — AWS rejects this as an invalid filter. ' +
          'Omit the filter argument entirely to search without filtering.',
      );
    }
  }

  /** Run an AWS call, surfacing any failure as a coded {@link S3VectorsError}. */
  private async _send<T>(operation: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error: unknown) {
      throw wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
        operation,
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      });
    }
  }

  /**
   * Runs `QueryVectors`, following AWS's `nextToken` pagination until `k`
   * vectors are collected or the result set is exhausted.
   *
   * @remarks
   * S3 Vectors caps each `QueryVectors` response at ~100 results even when
   * `topK` (`k`) is larger (AWS allows `topK` up to 10,000). Without paging
   * through `nextToken`, a caller requesting `k > 100` would silently get
   * back fewer than `k` documents.
   *
   * Also validates the queried index's distance metric — returned on every
   * `QueryVectors` response — against this store's configured
   * {@link AmazonS3VectorsConfig.distanceMetric}. Unlike the write path
   * (which calls `GetIndex` and can check this before ever touching the
   * index), a read never calls `GetIndex`, so this is the only point that
   * can catch a metric mismatch before silently computing a relevance
   * score against the wrong metric.
   *
   * Bounded by {@link MAX_QUERY_PAGES} so a response that never converges
   * can't drive an unbounded number of round trips. Deliberately does
   * *not* stop early on an empty-but-`nextToken`-bearing page — AWS's own
   * documented pagination contract and generated paginator don't treat an
   * empty page as end-of-results either, and a heavily-filtered query is a
   * plausible way to get one legitimately, with real results still on a
   * later page.
   */
  private async _queryVectors(
    operation: string,
    k: number,
    input: {
      queryVector: { float32: number[] };
      filter: __DocumentType | undefined;
      returnMetadata: boolean;
      returnDistance: boolean;
    },
  ): Promise<S3OutputVector[]> {
    this._validateK(operation, k);
    this._validateFilter(operation, input.filter);

    const results: S3OutputVector[] = [];
    let nextToken: string | undefined;
    let pageCount = 0;

    do {
      const response = await this._send('QueryVectors', () =>
        this._client.send(
          new QueryVectorsCommand({
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
            topK: k,
            nextToken,
            ...input,
          }),
        ),
      );

      if (pageCount === 0 && response.distanceMetric !== undefined) {
        this._assertMetricMatches(response.distanceMetric, operation);
      }

      const page = (response.vectors ?? []) as S3OutputVector[];
      results.push(...page);
      nextToken = response.nextToken;
      pageCount++;
    } while (nextToken && results.length < k && pageCount < MAX_QUERY_PAGES);

    return results.slice(0, k);
  }

  /**
   * Auto-create the index (on the first batch) and send a single PutVectors batch.
   *
   * @internal Shared helper extracted from `addVectors` / `addDocuments`.
   */
  private async _ensureIndexAndPut(
    operation: string,
    batchOffset: number,
    vectors: number[][],
    documents: Document[],
    ids: string[],
  ): Promise<void> {
    // Validate metadata (and build the PutVectors payload) BEFORE ever touching
    // AWS — a collision must not leave a freshly-created, now-permanently-
    // misconfigured index behind.
    const putVectors = vectors.map((vec, j) => {
      const doc = documents[j]!;
      const id = ids[j]!;
      const metadata = buildPutMetadata(doc, this.pageContentMetadataKey, operation);

      return {
        key: id,
        data: { float32: vec },
        metadata: metadata as __DocumentType,
      };
    });

    if (batchOffset === 0) {
      // Checked per-caller, before joining any shared existence/creation
      // work below — a caller's own empty batch must never be blamed on a
      // different, concurrently-racing caller (or vice versa).
      const firstVector = vectors[0];
      if (!firstVector || firstVector.length === 0) {
        throw this._validationError(
          operation,
          'Cannot determine vector dimension from empty batch',
        );
      }

      await this._validateBeforeWrite(firstVector, operation);
    }

    await this._send('PutVectors', () =>
      this._client.send(
        new PutVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          vectors: putVectors,
        }),
      ),
    );
  }

  /**
   * Validate the first batch's vector against the index's actual
   * dimension/distance metric before any write — checked regardless of
   * {@link createIndexIfNotExist}, so a caller relying on an
   * externally-managed index (`createIndexIfNotExist: false`) still gets
   * an early, friendly `INDEX_CONFIG_MISMATCH` instead of an opaque AWS
   * error when the index's actual configuration doesn't match this
   * store's.
   *
   * @remarks
   * When `createIndexIfNotExist` is `false`, this flag means "the caller
   * manages the index lifecycle" — not "skip validation" — so the index's
   * dimension/metric is fetched via `GetIndex` once and cached in
   * {@link _validatedIndexInfo} (cleared by {@link delete} on a full-index
   * delete), rather than re-fetched on every write the way the auto-create
   * path's memoized existence-check naturally already is. If the index
   * genuinely doesn't exist yet, this deliberately does *not* throw —
   * `PutVectors` still fails naturally below, matching this flag's
   * pre-existing behavior for a missing index (it never auto-creates one).
   */
  private async _validateBeforeWrite(firstVector: number[], operation: string): Promise<void> {
    if (this.createIndexIfNotExist) {
      const existing = await this._ensureIndexExists(firstVector);
      if (existing !== null) {
        this._assertIndexCompatible(existing, firstVector, operation);
      }
      return;
    }

    if (this._validatedIndexInfo !== null) {
      this._assertIndexCompatible(this._validatedIndexInfo, firstVector, operation);
      return;
    }

    const existing = await this._getIndex();
    if (existing !== null) {
      this._validatedIndexInfo = existing;
      this._assertIndexCompatible(existing, firstVector, operation);
    }
  }

  /**
   * Ensure the configured index exists, creating it if needed, and return
   * its dimension/distance metric — from the pre-existing index, from the
   * index this call just created, or (after losing a cross-process
   * creation race) re-fetched so the winning process's actual committed
   * dimension/metric is still known — so every concurrent caller sharing
   * this memo has something to validate its own vector against. `null` is
   * only possible if that post-race re-fetch itself finds nothing (the
   * index was deleted again in the brief window since the conflict) —
   * an already-negligible race made one step more negligible, not a gap
   * left standing.
   *
   * In-flight creation attempts are memoized so concurrent callers share
   * one GetIndex/CreateIndex sequence instead of racing (same-process
   * safety); a `ConflictException` from CreateIndex itself (another process
   * won the race) is tolerated as success (cross-process safety). The memo
   * is cleared once the attempt settles, so a later top-level call still
   * re-verifies existence (e.g. after the index was deleted via `delete()`).
   *
   * @remarks
   * Only the existence-check/creation is memoized — never compatibility
   * validation itself. Callers must run {@link _assertIndexCompatible}
   * themselves against the returned value and their own vector; sharing a
   * single validation verdict across concurrent callers with potentially
   * different vector dimensions would silently skip validating everyone
   * but the first caller, and could reject a later, genuinely-correct
   * caller with an error describing an earlier caller's vector instead.
   * `firstVector` is only actually used by whichever caller's invocation
   * wins the race to start this memo (later concurrent callers get the
   * already-in-flight promise back before their own argument is ever
   * consulted) — callers must validate their own vector is non-empty
   * *before* calling this, which is exactly what makes this function safe
   * to call with a plain `number[]` instead of `number[] | undefined`.
   */
  private _ensureIndexExists(
    firstVector: number[],
  ): Promise<{ dimension: number; distanceMetric: DistanceMetric } | null> {
    if (this._ensureIndexPromise) return this._ensureIndexPromise;

    this._ensureIndexPromise = (async () => {
      try {
        const existing = await this._getIndex();
        if (existing !== null) {
          return existing;
        }

        try {
          await this._createIndex(firstVector.length);
        } catch (error: unknown) {
          const cause = (error as { cause?: unknown }).cause;
          if (!isAwsConflictException(cause)) throw error;
          // Another process created the index between our GetIndex and
          // CreateIndex calls. Fetch what it actually committed — without
          // this, every caller sharing this memo would skip validation
          // entirely, exactly the race this method exists to close.
          return await this._getIndex();
        }
        return { dimension: firstVector.length, distanceMetric: this.distanceMetric };
      } finally {
        this._ensureIndexPromise = null;
      }
    })();

    return this._ensureIndexPromise;
  }

  /**
   * Reject a write against an existing index whose dimension or distance
   * metric doesn't match this store's configuration — otherwise a dimension
   * mismatch surfaces later as an opaque `PutVectors` error, and a metric
   * mismatch would silently compute relevance scores against the wrong metric.
   */
  private _assertIndexCompatible(
    existing: { dimension: number; distanceMetric: DistanceMetric },
    firstVector: number[],
    operation: string,
  ): void {
    if (existing.dimension !== firstVector.length) {
      throw new S3VectorsError(
        `Index "${this.indexName}" has dimension ${existing.dimension}, but the vector being written has dimension ${firstVector.length}.`,
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
        { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
      );
    }
    this._assertMetricMatches(existing.distanceMetric, operation);
  }

  /**
   * Reject a mismatch between an actual (existing-index or query-response)
   * distance metric and this store's configured one. Shared by the write
   * path ({@link _assertIndexCompatible}) and the read path
   * ({@link _queryVectors}) — a metric mismatch would silently compute
   * relevance scores against the wrong metric either way.
   */
  private _assertMetricMatches(actualMetric: DistanceMetric, operation: string): void {
    if (actualMetric !== this.distanceMetric) {
      throw new S3VectorsError(
        `Index "${this.indexName}" uses distance metric "${actualMetric}", but this store is configured for "${this.distanceMetric}". Relevance scores would be computed against the wrong metric.`,
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
        { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
      );
    }
  }

  /** Check whether the configured index already exists, returning its dimension/metric if so. */
  private async _getIndex(): Promise<{ dimension: number; distanceMetric: DistanceMetric } | null> {
    try {
      const result = await this._client.send(
        new GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
      );
      const { dimension, distanceMetric } = result.index as {
        dimension: number;
        distanceMetric: DistanceMetric;
      };
      return { dimension, distanceMetric };
    } catch (error: unknown) {
      if (isAwsNotFoundException(error)) return null;
      throw wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
        operation: 'GetIndex',
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      });
    }
  }

  /**
   * Create the vector index with the given dimension.
   *
   * @throws {S3VectorsError} If auto-adding {@link pageContentMetadataKey}
   * to {@link nonFilterableMetadataKeys} would exceed AWS's 10-key cap.
   * @remarks
   * This must throw rather than silently create the index with page
   * content left out of the non-filterable list: page content would then
   * count as *filterable* metadata, capped at 2 KB per vector by AWS —
   * and S3 Vectors has no `UpdateIndex`, so a document over that size
   * would only fail at write time, against an index that can never be
   * fixed without deleting it (and every vector already in it).
   */
  private async _createIndex(dimension: number): Promise<void> {
    const MAX_NON_FILTERABLE_KEYS = 10;
    const configuredKeys = this.nonFilterableMetadataKeys ?? [];
    const withPageContentKey =
      this.pageContentMetadataKey === null
        ? this.nonFilterableMetadataKeys
        : [...new Set([...configuredKeys, this.pageContentMetadataKey])];

    // Scoped to "adding the page-content key specifically is what pushes
    // this over the cap" — a caller-configured list that already exceeds
    // the cap on its own (pageContentMetadataKey: null included) is a
    // different, pre-existing user error that AWS's own CreateIndex
    // validation already rejects clearly; this message would be
    // misleading for that case since no page-content key is being added.
    if (
      this.pageContentMetadataKey !== null &&
      withPageContentKey &&
      withPageContentKey.length > MAX_NON_FILTERABLE_KEYS
    ) {
      throw this._validationError(
        'createIndex',
        `Cannot add pageContentMetadataKey ("${this.pageContentMetadataKey}") to ` +
          `nonFilterableMetadataKeys — that would exceed AWS's ${MAX_NON_FILTERABLE_KEYS}-key ` +
          `cap (currently ${configuredKeys.length} configured). Reduce ` +
          `nonFilterableMetadataKeys, or set pageContentMetadataKey: null to store page content ` +
          `as filterable metadata instead (capped at 2 KB per vector by AWS).`,
      );
    }

    await this._send('CreateIndex', () =>
      this._client.send(
        new CreateIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          dataType: this.dataType,
          dimension,
          distanceMetric: this.distanceMetric,
          ...(withPageContentKey && withPageContentKey.length > 0
            ? { metadataConfiguration: { nonFilterableMetadataKeys: withPageContentKey } }
            : {}),
        }),
      ),
    );
  }
}
