import { S3VectorsClient, type EncryptionConfiguration } from '@aws-sdk/client-s3vectors';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { Document, type DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore, type MaxMarginalRelevanceSearchOptions } from '@langchain/core/vectorstores';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { addDocuments, addVectors } from './actions/add.js';
import { deleteVectors } from './actions/delete.js';
import { getByIds } from './actions/get-by-ids.js';
import { listDocuments, listVectors } from './actions/list.js';
import { mmrSearch } from './actions/mmr.js';
import { searchByVector, selectRelevanceScoreFn } from './actions/search.js';
import { validateFilter } from './internal/filter.js';
import { assertK, rejectSignalInCallbacksSlot, validationError } from './internal/guards.js';
import {
  createIndexLifecycle,
  nonFilterableKeys,
  type IndexLifecycle,
} from './internal/index-lifecycle.js';
import { putBatch } from './internal/put-batch.js';
import { checkAborted } from './internal/signals.js';
import {
  AmazonS3VectorsRetriever,
  createRetriever,
  type AmazonS3VectorsRetrieverFields,
} from './retriever.js';
import { attachInstance } from './shared/errors/decorate.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { isStubEmbeddings, StubEmbeddings } from './shared/stub-embeddings.js';
import { assertValidConfig, assertValidIndexConfig } from './shared/validation.js';
import type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  S3VectorsDeleteParams,
  S3VectorsListParams,
  S3VectorsRecord,
  VectorDataType,
} from './types.js';

/**
 * Default cap on batch AWS calls (PutVectors/DeleteVectors/GetVectors) in
 * flight at once. Overridable per store via
 * {@link AmazonS3VectorsConfig.maxConcurrentBatchCalls}.
 */
const DEFAULT_MAX_CONCURRENT_BATCH_CALLS = 10;

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
 * large document sets.
 *
 * Throttling and transient (5xx) failures are retried automatically by the
 * AWS SDK; tune this via the `maxAttempts` and `retryMode` config options.
 *
 * Maximal Marginal Relevance (`maxMarginalRelevanceSearch`) is implemented:
 * candidates come from `QueryVectors`, their embeddings from `GetVectors`, and
 * the selection from `@langchain/core`'s own `maximalMarginalRelevance`.
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
  /**
   * The metadata-filter shape accepted by every search method (S3 Vectors'
   * native filter syntax, e.g. `{ genre: "scifi" }` or `{ $and: [...] }`).
   * This is the type LangChain's `VectorStore` reads via `this['FilterType']`
   * — a public part of the contract, not an implementation detail.
   */
  declare FilterType: Record<string, unknown>;

  /**
   * Pinned here rather than left to `@langchain/core`'s default.
   * {@link S3VectorsErrorContext.instance} hands a live store handle to
   * callers, and `Serializable#toJSON()` renders it as a harmless
   * type-identifier stub — instead of dumping instance fields, `_client`
   * and its credentials included — only while this is `false`. Declaring
   * it explicitly keeps that true even if the upstream default ever
   * changes; a regression test asserts no client internals serialize.
   */
  lc_serializable = false;

  // ── Config ────────────────────────────────────────────────────────────

  readonly vectorBucketName: string;
  readonly indexName: string;
  readonly dataType: VectorDataType;
  readonly distanceMetric: DistanceMetric;
  readonly nonFilterableMetadataKeys: string[] | undefined;
  readonly pageContentMetadataKey: string | null;
  readonly createIndexIfNotExist: boolean;
  readonly encryptionConfiguration: EncryptionConfiguration | undefined;
  readonly tags: Record<string, string> | undefined;
  readonly maxConcurrentBatchCalls: number;

  private readonly _relevanceScoreFn: ((distance: number) => number) | undefined;
  private readonly _queryEmbeddings: EmbeddingsInterface | undefined;
  private readonly _client: S3VectorsClient;

  /**
   * Existence tracking for this store's index. Owns the shared
   * `GetIndex`/`CreateIndex` memo, and remembers only that the index exists —
   * never its dimension or metric, because nothing asks (see DESIGN.md §4).
   */
  private readonly _lifecycle: IndexLifecycle;

  /**
   * The index's non-filterable keys, merged with the page-content key exactly
   * as index creation merges them, so the filterable-byte budget is measured
   * against the same set the index was built with.
   */
  private readonly _nonFilterableKeys: readonly string[];

  /** The bucket and index every error names. */
  private get _scope(): { vectorBucketName: string; indexName: string } {
    return { vectorBucketName: this.vectorBucketName, indexName: this.indexName };
  }

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
   * @param config.encryptionConfiguration - Server-side encryption for an auto-created index (ignored for an existing index)
   * @param config.tags - Tags for an auto-created index (ignored for an existing index)
   * @param config.maxConcurrentBatchCalls - Cap on concurrent batch AWS calls (default: `10`)
   */
  constructor(embeddings: EmbeddingsInterface | undefined, config: AmazonS3VectorsConfig) {
    // Before `super()`, which copies config onto `lc_kwargs`, and before any
    // default is applied: a store that cannot work should not exist.
    assertValidConfig(config);
    // LangChain's Serializable base copies its second argument onto
    // `this.lc_kwargs` verbatim. That field is enumerable, so
    // `util.inspect(store)` / `console.log(store)` — and therefore any
    // logger that renders an error's `context.instance` — would print the
    // caller's `credentials` (a static secretAccessKey included) in clear
    // text. Live objects (the SDK client, the embeddings models) don't
    // belong in a kwargs snapshot either. Everything else is plain config.
    const {
      credentials: _credentials,
      client: _client,
      embeddings: _embeddings,
      queryEmbeddings: _queryEmbeddings,
      ...serializableKwargs
    } = config;
    super(embeddings ?? config.embeddings ?? new StubEmbeddings(), serializableKwargs);

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
    this.encryptionConfiguration = config.encryptionConfiguration;
    this.tags = config.tags;
    this.maxConcurrentBatchCalls =
      config.maxConcurrentBatchCalls ?? DEFAULT_MAX_CONCURRENT_BATCH_CALLS;
    if (!Number.isInteger(this.maxConcurrentBatchCalls) || this.maxConcurrentBatchCalls <= 0) {
      throw validationError(
        'constructor',
        this._scope,
        `config.maxConcurrentBatchCalls must be a positive integer (received ${String(config.maxConcurrentBatchCalls)}).`,
      );
    }
    this._relevanceScoreFn = config.relevanceScoreFn;
    this._queryEmbeddings = config.queryEmbeddings;

    // A value check on config.serviceId, not a prototype-chain check —
    // survives a bundler duplicating @aws-sdk/client-s3vectors across a
    // module boundary, which would make a legitimate client fail instanceof/
    // isPrototypeOf. Mirrors the intent of this file's Symbol.for-registry
    // brands (S3VectorsError, StubEmbeddings) for a third-party class this
    // library can't stamp a brand onto itself.
    //
    // `null` is treated exactly like an omitted client — an optional field
    // defaulted to `null` by a DI framework or an untyped caller means "not
    // provided", and this file already reads a `null` filter as "no filter"
    // (see _validateFilter). Previously `null !== undefined` was true here,
    // so evaluation reached `null.config` and threw a raw, uncoded
    // TypeError, breaking the guarantee that every failure is typed.
    //
    // A non-nullish value that isn't an S3VectorsClient is a different
    // thing: a real caller mistake. It throws rather than warning and
    // falling back, because the fallback builds a client from the ambient
    // credential chain and default region — so a caller who passed an
    // explicit but wrong client could silently read and write against a
    // different AWS account or region than they intended.
    const suppliedClient = config.client ?? undefined;
    if (suppliedClient !== undefined && suppliedClient.config?.serviceId !== 'S3Vectors') {
      throw validationError(
        'constructor',
        this._scope,
        'config.client is not an S3VectorsClient from "@aws-sdk/client-s3vectors" (its ' +
          'config.serviceId is not "S3Vectors"). Pass a real S3VectorsClient, or omit `client` ' +
          'entirely and supply `region`/`credentials`/`endpoint` instead — falling back ' +
          'silently could point this store at a different AWS account or region.',
      );
    }

    this._client =
      suppliedClient ??
      new S3VectorsClient({
        region: config.region,
        credentials: config.credentials,
        endpoint: config.endpoint,
        maxAttempts: config.maxAttempts,
        retryMode: config.retryMode,
      });

    this._nonFilterableKeys = nonFilterableKeys({
      dataType: this.dataType,
      distanceMetric: this.distanceMetric,
      pageContentMetadataKey: this.pageContentMetadataKey,
      nonFilterableMetadataKeys: this.nonFilterableMetadataKeys,
    });

    this._lifecycle = createIndexLifecycle(
      {
        client: this._client,
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      },
      {
        dataType: this.dataType,
        distanceMetric: this.distanceMetric,
        pageContentMetadataKey: this.pageContentMetadataKey,
        nonFilterableMetadataKeys: this.nonFilterableMetadataKeys,
        encryptionConfiguration: this.encryptionConfiguration,
        tags: this.tags,
      },
    );
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
   * @param options.ids - Custom IDs for each vector. When omitted, each
   * document's own `id` is used if it has one (e.g. a `Document` returned
   * by {@link getByIds}, enabling a natural read-modify-write upsert); a
   * fresh UUID is generated only for documents with no `id` of their own.
   * @param options.batchSize - Number of vectors per `PutVectors` call (default: 200)
   * @param options.signal - Abort an in-progress write. Cancels the AWS SDK
   * request currently in flight and stops any further `PutVectors` calls
   * from starting; a batch's `PutVectors` call already in flight when the
   * signal fires is cancelled mid-request, not allowed to complete.
   * @returns The IDs assigned to each stored vector
   * @throws Error if counts of vectors, documents, or IDs don't match, or
   * if any id (supplied or taken from a document) is not a non-empty
   * string or appears more than once in the same call — S3 Vectors keys
   * must be non-empty, and a duplicate key inside one call would silently
   * overwrite an earlier vector with a later one. On a partial-write
   * failure (a later batch fails after earlier ones already committed),
   * the thrown {@link S3VectorsError}'s `context.writtenIds` lists every
   * id that was durably written before the failure — check it before
   * retrying, especially for auto-generated ids, which would otherwise be
   * impossible to find or reconcile again.
   */
  async addVectors(
    vectors: number[][],
    documents: DocumentInterface[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<string[]> {
    return await addVectors({
      vectors,
      documents,
      ids: options?.ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal: options?.signal,
      putBatch: this._putBatch.bind(this),
      ...this._scope,
    });
  }

  /**
   * Embed documents and store them in the vector index.
   *
   * @remarks
   * Documents are embedded **per batch, one batch at a time** to keep peak
   * embedding-provider load low for large document sets —
   * `embedDocuments` is never
   * called concurrently for two batches, since most embedding providers
   * rate-limit aggressively and this library gives no retry/backoff
   * guarantee for that call. Embedding and writing are **pipelined**: once
   * a batch is embedded, its `PutVectors` call is dispatched and the next
   * batch is embedded immediately, without waiting for that put to finish.
   * At most {@link maxConcurrentBatchCalls} (default 10) `PutVectors`
   * calls are in flight at once; when that window is full, embedding
   * pauses until one of them settles. AWS's own SDK already retries
   * throttling on the put side. Peak memory for in-flight vectors is
   * therefore bounded by roughly `(maxConcurrentBatchCalls + 1) × batchSize`
   * vectors, in exchange for meaningfully higher write throughput on
   * large ingests than a strict embed-then-put loop.
   *
   * The very first batch is the exception: it is embedded and written
   * alone, and awaited, before anything else starts — it is the one that
   * creates or validates the index, and every later batch depends on that
   * having happened.
   *
   * @param documents - Array of documents to embed and store
   * @param options - Optional settings
   * @param options.ids - Custom IDs for each vector. When omitted, each
   * document's own `id` is used if it has one (e.g. a `Document` returned
   * by {@link getByIds}, enabling a natural read-modify-write upsert); a
   * fresh UUID is generated only for documents with no `id` of their own.
   * @param options.batchSize - Number of documents per embedding + put batch (default: 200)
   * @param options.signal - Abort an in-progress write. `embedDocuments`
   * itself can't be cancelled mid-call (LangChain's `EmbeddingsInterface`
   * has no signal support), so a batch already being embedded when the
   * signal fires still completes — but no further batch is embedded or put
   * afterward, and any `PutVectors` call already in flight is cancelled
   * mid-request.
   * @returns The IDs assigned to each stored vector
   * @throws Error if count of IDs doesn't match count of documents, or if
   * any id (supplied or taken from a document) is not a non-empty string
   * or appears more than once in the same call. On a partial-write failure
   * (a later batch fails after earlier ones already committed), the thrown
   * {@link S3VectorsError}'s `context.writtenIds` lists every id that was
   * durably written before the failure — check it before retrying,
   * especially for auto-generated ids, which would otherwise be impossible
   * to find or reconcile again. A failure stops further batches from being
   * embedded or written; the error is thrown only after every `PutVectors`
   * call already in flight has settled, so `writtenIds` is complete.
   */
  async addDocuments(
    documents: DocumentInterface[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<string[]> {
    return await addDocuments({
      documents,
      ids: options?.ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal: options?.signal,
      embeddings: this._getIndexEmbeddings(),
      putBatch: this._putBatch.bind(this),
      ...this._scope,
    });
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
   * @param signal - Abort an in-progress search. Cancels the `QueryVectors`
   * call currently in flight and stops any further pagination.
   * @returns Array of `[Document, distance]` tuples, ordered by similarity
   * @throws A coded `AWS_INVALID_RESPONSE` error if a result is missing its
   * `distance` — this always requests `returnDistance: true`, so a missing
   * value means a malformed response rather than a legitimately scoreless
   * result. Fails closed instead of defaulting to the best possible score.
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType'],
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    return await searchByVector({
      client: this._client,
      operation: 'similaritySearchVectorWithScore',
      distanceMetric: this.distanceMetric,
      queryVector: query,
      k,
      filter,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal,
      ...this._scope,
    });
  }

  // ── Public API beyond the VectorStore base class ──────────────────────

  /**
   * Run a text-based similarity search and return documents with scores.
   *
   * The query string is embedded using the query-embedding model, then
   * {@link similaritySearchVectorWithScore} is called.
   *
   * @remarks
   * Validates `k` before embedding — an invalid `k` shouldn't cost a
   * billable `embedQuery` call before failing.
   *
   * @param _callbacks - Accepted and ignored, per `@langchain/core`'s
   * `VectorStore` signature. Passing an `AbortSignal` here throws a coded
   * `VALIDATION` error rather than silently running the search uncancelled —
   * the signal belongs in the fifth argument.
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   */
  async similaritySearchWithScore(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    // Everything cheap and synchronous runs before the billable — and
    // uncancellable — embedQuery call: a signal in the wrong slot, an
    // invalid k, an invalid filter, or a signal that already fired should
    // not cost an embedding round trip before failing. _validateFilter runs
    // again inside _queryVectors for the direct-vector entry points;
    // running it twice here is free.
    rejectSignalInCallbacksSlot('similaritySearchWithScore', this._scope, _callbacks);
    assertK('similaritySearchWithScore', this._scope, k);
    validateFilter(filter, 'similaritySearchWithScore', this._scope);
    // embedQuery has no signal support (LangChain's EmbeddingsInterface
    // doesn't accept one), so it can't self-cancel the way _send()'s AWS
    // calls do — check explicitly, matching addDocuments's guard before its
    // own embedDocuments call. Only the QueryVectors call after it can be
    // cancelled mid-flight.
    this._checkAborted('similaritySearchWithScore', signal);
    const queryVector = await this._getQueryEmbeddings().embedQuery(query);
    return this.similaritySearchVectorWithScore(queryVector, k, filter, signal);
  }

  /**
   * Run a text-based similarity search and return documents (no scores).
   *
   * @remarks
   * Overrides `VectorStore`'s default implementation, which embeds the
   * query with the indexing embedding model. This override routes through
   * {@link similaritySearchWithScore}, so a configured `queryEmbeddings`
   * model is used for the query, matching `asRetriever()`'s behavior.
   *
   * @param _callbacks - Accepted and ignored, per `@langchain/core`'s
   * `VectorStore` signature. Passing an `AbortSignal` here throws a coded
   * `VALIDATION` error rather than silently running the search uncancelled —
   * the signal belongs in the fifth argument.
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   */
  async similaritySearch(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    // Checked here as well as in the delegate: this forwards `undefined`
    // into that slot, so the delegate's own check can never see what this
    // caller actually passed.
    rejectSignalInCallbacksSlot('similaritySearch', this._scope, _callbacks);
    return (await this.similaritySearchWithScore(query, k, filter, undefined, signal)).map(
      ([doc]) => doc,
    );
  }

  /**
   * Run a text-based similarity search and return documents with
   * *relevance scores* (higher is better), converted from S3 Vectors'
   * raw distance via {@link AmazonS3VectorsConfig.relevanceScoreFn} when
   * configured, otherwise `cosineRelevanceScoreFn` — which is the exact
   * inverse of what a cosine index returns. A **euclidean** index has no
   * built-in conversion and raises `VALIDATION` here unless
   * `relevanceScoreFn` is configured: euclidean distance is unbounded above,
   * so no fixed formula maps it to a comparable score without knowing the
   * embedding's scale.
   *
   * @param callbacks - The `Callbacks` slot every text-based method on this
   * class reserves in this position, accepted and ignored exactly as in
   * {@link similaritySearch} and {@link similaritySearchWithScore}. An
   * `AbortSignal` passed here is rejected with a coded `VALIDATION` error
   * before the billable `embedQuery` call, as on those siblings. (Through
   * 0.x this method honored a signal in this position, where earlier
   * versions expected it; 1.0 aligned it with the rest of the class.)
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   */
  async similaritySearchWithRelevanceScores(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    rejectSignalInCallbacksSlot('similaritySearchWithRelevanceScores', this._scope, callbacks);
    const scoreFn = this._selectRelevanceScoreFn();
    const results = await this.similaritySearchWithScore(query, k, filter, undefined, signal);
    return results.map(([doc, distance]) => [doc, scoreFn(distance)]);
  }

  /**
   * Maximal Marginal Relevance search: relevance traded against diversity.
   *
   * Accepts:
   * - `options.k` — documents to return (default 4).
   * - `options.fetchK` — candidates considered before selecting (default 20).
   *   Below `k` is not an error: at most that many candidates exist.
   * - `options.lambda` — 0 to 1 inclusive, 0 favouring diversity entirely and
   *   1 relevance entirely (default 0.5).
   * - `callbacks` — core's `Callbacks` slot, accepted and ignored. A signal
   *   here is rejected; it belongs in the fourth argument.
   * - `signal` — a fourth parameter this package adds. Core declares three
   *   (`@langchain/core@1.2.9` `dist/vectorstores.d.ts:528`) and passes no
   *   config to `_getRelevantDocuments`, so a retriever-scoped signal has no
   *   other route to the underlying requests. Absent behaves exactly as core's
   *   three-parameter call.
   *
   * @throws {S3VectorsError} `VALIDATION` for `k`, `fetchK` or `lambda`, before
   * the billable `embedQuery`; otherwise whatever the search and fetch raise.
   */
  async maxMarginalRelevanceSearch(
    query: string,
    options: MaxMarginalRelevanceSearchOptions<this['FilterType']>,
    callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    rejectSignalInCallbacksSlot('maxMarginalRelevanceSearch', this._scope, callbacks);
    const k = options.k ?? 4;
    const fetchK = options.fetchK ?? 20;
    const lambda = options.lambda ?? 0.5;
    validateFilter(options.filter, 'maxMarginalRelevanceSearch', this._scope);

    // embedQuery has no signal support, so it cannot self-cancel — check
    // before spending a billable, uncancellable call.
    this._checkAborted('maxMarginalRelevanceSearch', signal);
    const queryVector = await this._getQueryEmbeddings().embedQuery(query);

    return mmrSearch({
      client: this._client,
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: this.distanceMetric,
      queryVector,
      k,
      fetchK,
      lambda,
      filter: options.filter,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal,
      ...this._scope,
    });
  }

  /**
   * Delete vectors by ID, or delete the entire index.
   *
   * @param params - Deletion parameters
   * @param params.ids - Vector IDs to delete
   * @param params.batchSize - Number of IDs per `DeleteVectors` call (default: 500)
   * @param params.deleteAll - Must be `true` (with `ids` omitted) to delete the
   * entire **index** — the `DeleteIndex` API, not a bulk `DeleteVectors`.
   * Everything attached to the index goes with it: its encryption
   * configuration, tags, and non-filterable-metadata configuration, plus
   * any IAM policy statements scoped to the index ARN keep pointing at a
   * resource that no longer exists. A later write with
   * `createIndexIfNotExist: true` re-creates the index from *this store's*
   * configuration (`dimension` from the first vector, `distanceMetric`,
   * `nonFilterableMetadataKeys`, `encryptionConfiguration`, `tags`), which
   * may differ from how the original was provisioned. If the index must
   * survive, delete vectors by id instead — S3 Vectors has no
   * "truncate" API.
   * @param params.signal - Abort an in-progress delete. Cancels the
   * `DeleteVectors`/`DeleteIndex` call currently in flight and stops any
   * further batches from starting.
   * @throws Error if both `ids` and `deleteAll` are omitted — a safety guard against an
   * accidentally-`undefined` `ids` array silently wiping the whole index — or if both `ids`
   * and `deleteAll` are passed together. On a partial-delete failure (a
   * later batch fails after earlier ones already succeeded), the thrown
   * {@link S3VectorsError}'s `context.deletedIds` lists every id confirmed
   * deleted before the failure — deleting is idempotent, so a blind retry
   * of the full `ids` list is always safe regardless, but `deletedIds`
   * tells you exactly what already happened.
   */
  async delete(params?: S3VectorsDeleteParams): Promise<void> {
    await deleteVectors({
      client: this._client,
      ids: params?.ids,
      deleteAll: params?.deleteAll === true,
      batchSize: params?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal: params?.signal,
      deleteIndex: (signal) => this._lifecycle.deleteIndex(signal),
      ...this._scope,
    });
  }

  /**
   * Retrieve documents by their vector IDs.
   *
   * @remarks
   * The order of the returned documents matches the order of the input IDs.
   * When duplicate IDs are present, metadata is deep-copied (via `structuredClone`)
   * to prevent shared-reference mutations between returned documents.
   *
   * **A missing id yields `undefined` in its slot**, never a shorter array.
   * `GetVectors` returns neither an entry nor an error for a key that is not
   * there (`docs/evidence/get-vectors-absent-keys.md`), so absence is an
   * ordinary answer and the result stays aligned with the id list — the
   * caller reads `result[i]` for `ids[i]` without tracking which ones
   * survived. This is the `@langchain/core` `VectorStore.getByIds`
   * contract's `(Document | undefined)[]` and not a stricter one.
   *
   * @param ids - Array of vector IDs to retrieve
   * @param options - Optional settings
   * @param options.batchSize - Number of IDs per `GetVectors` call (default: 100)
   * @param options.signal - Abort an in-progress fetch. Cancels the
   * `GetVectors` calls currently in flight and stops any further batches
   * from starting.
   * @returns Array of documents in the same order as the input IDs
   * @throws Error if any ID is not found in the vector store, or if a
   * `GetVectors` batch call fails. Either way, the thrown
   * {@link S3VectorsError}'s `context.foundIds` lists every id already
   * confirmed found before the failure — including one found by a
   * concurrent batch that succeeded alongside the one that failed — so a
   * caller doesn't have to re-fetch everything from scratch.
   */
  async getByIds(
    ids: string[],
    options?: { batchSize?: number; signal?: AbortSignal },
  ): Promise<(Document | undefined)[]> {
    return await getByIds({
      client: this._client,
      ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal: options?.signal,
      ...this._scope,
    });
  }

  /**
   * Every document in the index, one at a time.
   *
   * @remarks
   * `ListVectors` takes no filter and promises no order, so this is an audit
   * and export primitive, not a query one — use {@link similaritySearch} to
   * find documents. It is an async generator, so memory stays bounded by one
   * page however large the index, and breaking out of the loop issues no
   * further request.
   *
   * Requires **`s3vectors:ListVectors` and `s3vectors:GetVectors`**: the
   * listing asks for metadata, and AWS answers a metadata or data request made
   * without `s3vectors:GetVectors` with `403 Forbidden`.
   *
   * @param options - Optional settings
   * @param options.pageSize - Vectors per `ListVectors` call, an integer
   * 1–1000 (service default 500). Advisory: AWS ends a page at 1 MB of
   * processed data regardless, so short pages are normal and only an absent
   * `nextToken` ends the listing.
   * @param options.signal - Abort an in-progress listing. Checked before each
   * page and threaded into the request.
   * @returns An async generator of documents, mapped exactly as
   * {@link getByIds} maps them.
   * @throws {S3VectorsError} `VALIDATION` for `pageSize`, before any request;
   * `ABORTED`; `ACCESS_DENIED` naming the missing permission; otherwise the
   * class the failure maps to, carrying `pagesScanned` and the number already
   * yielded — items already yielded have been consumed, so a listing is not
   * atomic and does not pretend to be.
   */
  listDocuments(options?: S3VectorsListParams): AsyncGenerator<Document> {
    return listDocuments({
      client: this._client,
      operation: 'listDocuments',
      pageContentMetadataKey: this.pageContentMetadataKey,
      pageSize: options?.pageSize,
      signal: options?.signal,
      ...this._scope,
    });
  }

  /**
   * Every vector in the index with its embedding, one at a time.
   *
   * @remarks
   * The migration primitive. An index's `dimension` and `distanceMetric` are
   * fixed at creation, so changing either means copying every record into a
   * new index; this yields exactly what {@link addVectors} takes back.
   *
   * Costs an order of magnitude more round trips than {@link listDocuments}:
   * the 1 MB page cap is reached at roughly 40 vectors of 1,536 dimensions,
   * against the 500-row default a metadata-only page reaches comfortably. Two
   * methods rather than one flag, so that difference is visible at the call
   * site.
   *
   * Requires the same two permissions as {@link listDocuments}.
   *
   * @param options - Optional settings, as {@link listDocuments} takes them
   * @returns An async generator of `{ id, vector, document }`
   * @throws {S3VectorsError} What {@link listDocuments} throws, plus
   * `AWS_INVALID_RESPONSE` if a record arrives without data despite this call
   * requesting it — a record whose embedding is missing is not skipped,
   * because a migration that dropped records silently would produce a target
   * index that looks complete and is not.
   */
  listVectors(options?: S3VectorsListParams): AsyncGenerator<S3VectorsRecord> {
    return listVectors({
      client: this._client,
      operation: 'listVectors',
      pageContentMetadataKey: this.pageContentMetadataKey,
      pageSize: options?.pageSize,
      signal: options?.signal,
      ...this._scope,
    });
  }

  /**
   * Build a retriever over this store.
   *
   * @remarks
   * Returns an {@link AmazonS3VectorsRetriever} — core's `VectorStoreRetriever`
   * plus a `signal` field. Everything core documents works unchanged, the
   * numeric `asRetriever(4)` form included.
   *
   * **Which signal does what.** A signal passed here, as a retriever field,
   * reaches `QueryVectors` and `GetVectors` and cancels the AWS request. A
   * signal passed to `invoke(query, { signal })` ends that invocation only:
   * core's `BaseRetriever.invoke` never hands the config to
   * `_getRelevantDocuments` (`@langchain/core@1.2.9`
   * `dist/retrievers/index.js:81`, `:85`), so no subclass can route it to the
   * request. Both may be given at once.
   *
   * @param kOrFields - Documents to retrieve, or a fields object
   * (`k`, `filter`, `searchType`, `searchKwargs`, `signal`, `tags`,
   * `metadata`, `verbose`, `callbacks`)
   * @param filter - Metadata filter, for the numeric form
   * @param callbacks - Callbacks, for the numeric form
   * @param tags - Run tags, for the numeric form. This store's type is
   * appended to whatever is given, as core does
   * @param metadata - Run metadata, for the numeric form
   * @param verbose - Verbose logging, for the numeric form
   * @returns A retriever bound to this store
   */
  override asRetriever(
    kOrFields?: number | AmazonS3VectorsRetrieverFields<this>,
    filter?: this['FilterType'],
    callbacks?: Callbacks,
    tags?: string[],
    metadata?: Record<string, unknown>,
    verbose?: boolean,
  ): AmazonS3VectorsRetriever<this> {
    return createRetriever(this, kOrFields, filter, callbacks, tags, metadata, verbose);
  }

  /**
   * Static factory: create an {@link AmazonS3Vectors} instance, embed
   * the given texts, and add them to the store.
   */
  static async fromTexts(
    texts: string[],
    metadatas: Record<string, unknown>[] | Record<string, unknown>,
    embeddings: EmbeddingsInterface,
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<AmazonS3Vectors> {
    if (!Array.isArray(texts)) {
      throw new S3VectorsError('texts must be an array.', S3VectorsErrorCode.VALIDATION, {
        operation: 'fromTexts',
      });
    }
    if (Array.isArray(metadatas) && metadatas.length !== texts.length) {
      throw new S3VectorsError(
        `Number of metadatas (${metadatas.length}) must match number of texts (${texts.length})`,
        S3VectorsErrorCode.VALIDATION,
        { operation: 'fromTexts' },
      );
    }

    const metaArray = Array.isArray(metadatas) ? metadatas : texts.map(() => metadatas);

    // `?? {}` rather than a non-null assertion: an untyped caller may omit
    // `metadatas` entirely, and this pins the empty-object answer here instead
    // of leaning on what `Document` happens to do with `undefined`.
    const documents = texts.map(
      (text, i) => new Document({ pageContent: text, metadata: metaArray[i] ?? {} }),
    );

    return AmazonS3Vectors.fromDocuments(documents, embeddings, config);
  }

  /**
   * Static factory: create an {@link AmazonS3Vectors} instance and add
   * the given documents to the store.
   *
   * @throws If the write fails — including partway through a multi-batch
   * write — the thrown {@link S3VectorsError}'s `context.instance` carries
   * the constructed (and possibly partially-written) store, so the caller
   * can act on `context.writtenIds` without reconstructing an equivalent
   * instance from the same embeddings/config.
   */
  static async fromDocuments(
    docs: DocumentInterface[],
    embeddings: EmbeddingsInterface,
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<AmazonS3Vectors> {
    const instance = new AmazonS3Vectors(embeddings, config);
    try {
      await instance.addDocuments(docs, {
        ids: config.ids,
        batchSize: config.batchSize,
        signal: config.signal,
      });
    } catch (error: unknown) {
      throw attachInstance(error, 'fromDocuments', instance._scope, instance);
    }
    return instance;
  }

  // ── Protected / internal helpers ──────────────────────────────────────

  /** @internal Select the correct relevance-score function. */
  _selectRelevanceScoreFn(): (distance: number) => number {
    return selectRelevanceScoreFn(this.distanceMetric, this._scope, this._relevanceScoreFn);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** Bind this store's configuration to one {@link putBatch} call. */
  private _putBatch(
    operation: string,
    batchOffset: number,
    vectors: number[][],
    documents: DocumentInterface[],
    ids: string[],
    signal?: AbortSignal,
  ): Promise<void> {
    return putBatch({
      client: this._client,
      operation,
      batchOffset,
      vectors,
      documents,
      ids,
      distanceMetric: this.distanceMetric,
      pageContentMetadataKey: this.pageContentMetadataKey,
      nonFilterableKeys: this._nonFilterableKeys,
      ensureIndex: this.createIndexIfNotExist
        ? (dimension, abort) => this._lifecycle.ensureExists(dimension, abort)
        : undefined,
      onIndexAbsent: () => {
        this._lifecycle.markAbsent();
      },
      signal,
      ...this._scope,
    });
  }

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

  /**
   * Throw an `ABORTED` error if `signal` has already fired. Used before a
   * step the AWS SDK can't cancel on its own (embedding a batch of
   * documents), so an aborted operation doesn't pay for one more expensive,
   * uncancellable call it no longer needs.
   */
  private _checkAborted(operation: string, signal: AbortSignal | undefined): void {
    checkAborted(operation, signal, {
      vectorBucketName: this.vectorBucketName,
      indexName: this.indexName,
    });
  }
}
