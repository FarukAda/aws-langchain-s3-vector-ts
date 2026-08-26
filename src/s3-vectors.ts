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
/** Max number of batch AWS calls (DeleteVectors/GetVectors) in flight at once. */
const MAX_CONCURRENT_BATCH_CALLS = 10;

/**
 * Max `QueryVectors` pages per search — defense-in-depth against a
 * response that keeps returning `nextToken` without ever satisfying `k`.
 * Set to AWS's own `topK` ceiling (10,000): even a heavily-filtered index
 * yielding as little as one real match per page still reaches `k` within
 * this bound at AWS's maximum `topK`, so a legitimate search is never
 * truncated by it — it only stops a response that never converges.
 */
const MAX_QUERY_PAGES = 10_000;

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
    if (vectors.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addVectors', batchSize);
    const ids = options?.ids ?? vectors.map(() => randomUUID().replace(/-/g, ''));

    if (ids.length !== vectors.length) {
      throw this._validationError(
        'addVectors',
        `Number of IDs (${ids.length}) must match number of vectors (${vectors.length})`,
      );
    }

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
    if (documents.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addDocuments', batchSize);
    const ids = options?.ids ?? documents.map(() => randomUUID().replace(/-/g, ''));

    if (ids.length !== documents.length) {
      throw this._validationError(
        'addDocuments',
        `Number of IDs (${ids.length}) must match number of documents (${documents.length})`,
      );
    }

    const embeddings = this._getIndexEmbeddings();
    let offset = 0;
    for (const batchDocs of chunk(documents, batchSize)) {
      const batchTexts = batchDocs.map((d) => d.pageContent);
      const batchVectors = await embeddings.embedDocuments(batchTexts);

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
    if (params?.ids !== undefined && params?.deleteAll === true) {
      throw this._validationError(
        'delete',
        'delete() cannot take both `ids` and `deleteAll: true` — pass one or the other.',
      );
    }
    const ids = params?.ids;

    if (ids === undefined) {
      if (params?.deleteAll !== true) {
        throw this._validationError(
          'delete',
          'delete() with no `ids` would delete the entire index. Pass `{ deleteAll: true }` ' +
            'to confirm, or pass `ids` to delete specific vectors.',
        );
      }
      await this._send('DeleteIndex', () =>
        this._client.send(
          new DeleteIndexCommand({
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
          }),
        ),
      );
    } else {
      const batchSize = params?.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
      this._validateBatchSize('delete', batchSize);
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
    this._validateBatchSize('getByIds', batchSize);
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

  /** Reject a non-positive batchSize before it can drive an infinite loop. */
  private _validateBatchSize(operation: string, batchSize: number): void {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw this._validationError(operation, 'batchSize must be a positive integer');
    }
  }

  /** Reject a non-positive k before it can drive excessive QueryVectors pagination. */
  private _validateK(operation: string, k: number): void {
    if (!Number.isInteger(k) || k <= 0) {
      throw this._validationError(operation, 'k must be a positive integer');
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

      if (
        pageCount === 0 &&
        response.distanceMetric !== undefined &&
        response.distanceMetric !== this.distanceMetric
      ) {
        throw new S3VectorsError(
          `Index "${this.indexName}" uses distance metric "${response.distanceMetric}", but this store is configured for "${this.distanceMetric}". Relevance scores would be computed against the wrong metric.`,
          S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
          { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
        );
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

    if (batchOffset === 0 && this.createIndexIfNotExist) {
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

      const existing = await this._ensureIndexExists(firstVector);
      if (existing !== null) {
        this._assertIndexCompatible(existing, firstVector, operation);
      }
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
   * Ensure the configured index exists, creating it if needed, and return
   * its dimension/distance metric — from the pre-existing index, or from
   * the index this call just created — so every concurrent caller sharing
   * this memo has something to validate its own vector against. Returns
   * `null` only when a *different* process won a cross-process creation
   * race: our own `CreateIndex` lost with a `ConflictException`, so we
   * never learn what dimension/metric the winner actually used.
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
          // CreateIndex calls — fine, but we don't know its actual
          // dimension/metric, so there's genuinely nothing to return.
          return null;
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
    if (existing.distanceMetric !== this.distanceMetric) {
      throw new S3VectorsError(
        `Index "${this.indexName}" uses distance metric "${existing.distanceMetric}", but this store is configured for "${this.distanceMetric}". Relevance scores would be computed against the wrong metric.`,
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

  /** Create the vector index with the given dimension. */
  private async _createIndex(dimension: number): Promise<void> {
    const MAX_NON_FILTERABLE_KEYS = 10;
    const withPageContentKey =
      this.pageContentMetadataKey === null
        ? this.nonFilterableMetadataKeys
        : [...new Set([...(this.nonFilterableMetadataKeys ?? []), this.pageContentMetadataKey])];
    // Don't silently push an existing, working config over AWS's 10-key cap —
    // fall back to the user's own list unchanged if auto-adding would exceed it.
    const nonFilterableKeys =
      withPageContentKey && withPageContentKey.length > MAX_NON_FILTERABLE_KEYS
        ? this.nonFilterableMetadataKeys
        : withPageContentKey;

    await this._send('CreateIndex', () =>
      this._client.send(
        new CreateIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          dataType: this.dataType,
          dimension,
          distanceMetric: this.distanceMetric,
          ...(nonFilterableKeys && nonFilterableKeys.length > 0
            ? { metadataConfiguration: { nonFilterableMetadataKeys: nonFilterableKeys } }
            : {}),
        }),
      ),
    );
  }
}
