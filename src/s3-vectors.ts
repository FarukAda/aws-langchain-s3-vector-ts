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
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore } from '@langchain/core/vectorstores';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
import { isAwsNotFoundException } from './shared/errors.js';
import { buildPutMetadata, createDocument } from './shared/metadata.js';
import { isStubEmbeddings, StubEmbeddings } from './shared/stub-embeddings.js';
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
   */
  constructor(embeddings: EmbeddingsInterface | undefined, config: AmazonS3VectorsConfig) {
    super(embeddings ?? config.embeddings ?? new StubEmbeddings(), config);

    this.vectorBucketName = config.vectorBucketName;
    this.indexName = config.indexName;
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- AWS credential types are complex and vary by SDK version
        credentials: config.credentials,
        endpoint: config.endpoint,
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
      throw new Error(
        `Number of vectors (${vectors.length}) must match number of documents (${documents.length})`,
      );
    }
    if (vectors.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    const ids = options?.ids ?? vectors.map(() => randomUUID().replace(/-/g, ''));

    if (ids.length !== vectors.length) {
      throw new Error(
        `Number of IDs (${ids.length}) must match number of vectors (${vectors.length})`,
      );
    }

    for (let i = 0; i < vectors.length; i += batchSize) {
      const slice = vectors.slice(i, i + batchSize);

      await this._ensureIndexAndPut(
        i,
        slice,
        slice.map((_, j) => documents[i + j]!),
        slice.map((_, j) => ids[i + j]!),
      );
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
    const ids = options?.ids ?? documents.map(() => randomUUID().replace(/-/g, ''));

    if (ids.length !== documents.length) {
      throw new Error(
        `Number of IDs (${ids.length}) must match number of documents (${documents.length})`,
      );
    }

    for (let i = 0; i < documents.length; i += batchSize) {
      const batchDocs = documents.slice(i, i + batchSize);
      const batchTexts = batchDocs.map((d) => d.pageContent);
      const batchVectors = await this.embeddings.embedDocuments(batchTexts);

      await this._ensureIndexAndPut(
        i,
        batchVectors,
        batchDocs,
        batchDocs.map((_, j) => ids[i + j]!),
      );
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
      throw new Error(
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
    const response = await this._client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        topK: k,
        queryVector: { float32: query },
        filter: filter as __DocumentType | undefined,
        returnMetadata: true,
        returnDistance: true,
      }),
    );

    const outputVectors = (response.vectors ?? []) as S3OutputVector[];
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
   */
  async similaritySearchWithScore(
    query: string,
    k = 4,
    filter?: this['FilterType'],
  ): Promise<[Document, number][]> {
    const queryVector = await this._getQueryEmbeddings().embedQuery(query);
    return this.similaritySearchVectorWithScore(queryVector, k, filter);
  }

  /**
   * Return documents most similar to a raw embedding vector (no scores).
   */
  async similaritySearchByVector(
    embedding: number[],
    k = 4,
    filter?: this['FilterType'],
  ): Promise<Document[]> {
    const response = await this._client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        topK: k,
        queryVector: { float32: embedding },
        filter: filter as __DocumentType | undefined,
        returnMetadata: true,
        returnDistance: false,
      }),
    );

    const outputVectors = (response.vectors ?? []) as S3OutputVector[];
    return outputVectors.map((v) => createDocument(v, this.pageContentMetadataKey));
  }

  /**
   * Delete vectors by ID, or delete the entire index when no IDs are given.
   *
   * @param params - Optional deletion parameters
   * @param params.ids - Vector IDs to delete (deletes entire index if omitted)
   * @param params.batchSize - Number of IDs per `DeleteVectors` call (default: 500)
   */
  async delete(params?: S3VectorsDeleteParams): Promise<void> {
    const ids = params?.ids;

    if (ids === undefined) {
      // Delete the entire index.
      await this._client.send(
        new DeleteIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
      );
    } else {
      const batchSize = params?.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
      for (let i = 0; i < ids.length; i += batchSize) {
        await this._client.send(
          new DeleteVectorsCommand({
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
            keys: ids.slice(i, i + batchSize),
          }),
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
    const docs: Document[] = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);

      const response = await this._client.send(
        new GetVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          keys: batchIds,
          returnData: false,
          returnMetadata: true,
        }),
      );

      const outputVectors = (response.vectors ?? []) as S3OutputVector[];
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
          throw new Error(`Id '${id}' not found in vector store.`);
        }
        docs.push(createDocument(v, this.pageContentMetadataKey, hasDuplicateIds));
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
    config: AmazonS3VectorsConfig & { ids?: string[] },
  ): Promise<AmazonS3Vectors> {
    const metaArray = Array.isArray(metadatas) ? metadatas : texts.map(() => metadatas);

    const documents = texts.map(
      (text, i) => new Document({ pageContent: text, metadata: metaArray[i] ?? {} }),
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
    config: AmazonS3VectorsConfig & { ids?: string[] },
  ): Promise<AmazonS3Vectors> {
    const instance = new AmazonS3Vectors(embeddings, config);
    await instance.addDocuments(docs, { ids: config.ids });
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
    if (!emb || isStubEmbeddings(emb)) {
      throw new Error(
        'No embedding model available for queries. ' +
          'Provide `embeddings` or `queryEmbeddings` in the config.',
      );
    }
    return emb;
  }

  /**
   * Auto-create the index (on the first batch) and send a single PutVectors batch.
   *
   * @internal Shared helper extracted from `addVectors` / `addDocuments`.
   */
  private async _ensureIndexAndPut(
    batchOffset: number,
    vectors: number[][],
    documents: Document[],
    ids: string[],
  ): Promise<void> {
    // Auto-create the index on the very first batch.
    if (batchOffset === 0 && this.createIndexIfNotExist) {
      const existing = await this._getIndex();
      if (existing === null) {
        const firstVector = vectors[0];
        if (!firstVector) {
          throw new Error('Cannot determine vector dimension from empty batch');
        }
        await this._createIndex(firstVector.length);
      }
    }

    const putVectors = vectors.map((vec, j) => {
      const doc = documents[j]!;
      const id = ids[j]!;
      const metadata = buildPutMetadata(doc, this.pageContentMetadataKey);

      return {
        key: id,
        data: { float32: vec },
        metadata: metadata as __DocumentType,
      };
    });

    await this._client.send(
      new PutVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        vectors: putVectors,
      }),
    );
  }

  /** Check whether the configured index already exists. */
  private async _getIndex(): Promise<Record<string, unknown> | null> {
    try {
      const result = await this._client.send(
        new GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
      );
      return result as unknown as Record<string, unknown>;
    } catch (error: unknown) {
      if (isAwsNotFoundException(error)) return null;
      throw error;
    }
  }

  /** Create the vector index with the given dimension. */
  private async _createIndex(dimension: number): Promise<void> {
    await this._client.send(
      new CreateIndexCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        dataType: this.dataType,
        dimension,
        distanceMetric: this.distanceMetric,
        ...(this.nonFilterableMetadataKeys
          ? {
              metadataConfiguration: {
                nonFilterableMetadataKeys: this.nonFilterableMetadataKeys,
              },
            }
          : {}),
      }),
    );
  }
}
