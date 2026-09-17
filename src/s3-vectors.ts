import { S3VectorsClient, type EncryptionConfiguration } from '@aws-sdk/client-s3vectors';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { Document, type DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore, type MaxMarginalRelevanceSearchOptions } from '@langchain/core/vectorstores';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { addDocuments, addVectors, type WriteConfig } from './actions/add.js';
import { deleteVectors } from './actions/delete.js';
import { getByIds } from './actions/get-by-ids.js';
import { listDocuments, listVectors } from './actions/list.js';
import { assertMmrParameters, mmrSearch } from './actions/mmr.js';
import { searchByVector, selectRelevanceScoreFn } from './actions/search.js';
import { validateFilter } from './internal/filter.js';
import {
  assertK,
  assertOptionsBag,
  assertQueryText,
  rejectSignalInCallbacksSlot,
  validationError,
} from './internal/guards.js';
import {
  assertKeysCreatable,
  createIndexLifecycle,
  nonFilterableKeys,
  type IndexLifecycle,
} from './internal/index-lifecycle.js';
import { putBatch } from './internal/put-batch.js';
import type { WriteRecord } from './internal/records.js';
import { checkAborted } from './internal/signals.js';
import {
  AmazonS3VectorsRetriever,
  createRetriever,
  type AmazonS3VectorsRetrieverFields,
} from './retriever.js';
import { renderValue, type RecordRef } from './shared/describe.js';
import { attachInstance, attachOperation } from './shared/errors/decorate.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { wrapCallerError } from './shared/errors/wrap-error.js';
import { isObjectLike } from './shared/objects.js';
import { isStubEmbeddings, StubEmbeddings } from './shared/stub-embeddings.js';
import {
  assertValidConfig,
  assertValidIndexConfig,
  failNonFilterableKeys,
  resolveClient,
} from './shared/validation.js';
import type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  S3VectorsDeleteIndexParams,
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
 * **Every method that takes an options bag refuses a non-object one** with
 * `VALIDATION`, rather than reading each option in it as unset. `undefined`
 * and `null` still mean "no options"; anything else — a string, a number, an
 * array — is a mistake whose cost is silence: `deleteIndex('cancel-me')` would
 * destroy the index with the signal dropped, and `addDocuments(docs, ids)`
 * with the ids in the bag's place would write UUIDs nobody can find again. For
 * the two enumeration methods the refusal arrives on the first `next()`, the
 * same place an out-of-range `pageSize` arrives, so one `try` around the loop
 * catches both.
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
  override lc_serializable = false;

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

  readonly #relevanceScoreFn: ((distance: number) => number) | undefined;
  readonly #queryEmbeddings: EmbeddingsInterface | undefined;
  readonly #client: S3VectorsClient;

  /**
   * Existence tracking for this store's index. Owns the shared
   * `GetIndex`/`CreateIndex` memo, and remembers only that the index exists —
   * never its dimension or metric, because nothing asks: AWS enforces the
   * dimension on every write and the metric is checked on every read.
   */
  readonly #lifecycle: IndexLifecycle;

  /**
   * The index's non-filterable keys, merged with the page-content key exactly
   * as index creation merges them, so the filterable-byte budget is measured
   * against the same set the index was built with.
   */
  readonly #nonFilterableKeys: readonly string[];

  /** The bucket and index every error names. */
  get #scope(): { vectorBucketName: string; indexName: string } {
    return { vectorBucketName: this.vectorBucketName, indexName: this.indexName };
  }

  /** What every write validates and builds its input against. */
  get #writeConfig(): WriteConfig {
    return {
      distanceMetric: this.distanceMetric,
      pageContentMetadataKey: this.pageContentMetadataKey,
      nonFilterableKeys: this.#nonFilterableKeys,
    };
  }

  // ── Constructor ───────────────────────────────────────────────────────

  /**
   * Create a new Amazon S3 Vectors store
   *
   * @param embeddings - Embedding model for indexing and querying, or `undefined` for raw-vector workflows
   * @param config - The store configuration. Every option, its default and its
   * constraints are documented on {@link AmazonS3VectorsConfig}; they are not
   * repeated here, because a second copy is how this list once came to omit
   * three of them.
   * @returns A store bound to one index. Constructing it issues **no AWS
   * request**: the index is checked, and created, on the first write that
   * needs it.
   * @throws {S3VectorsError} `VALIDATION` for any option outside the set or
   * shape its field documents — including a string AWS cannot decode where one
   * is sent to it (`pageContentMetadataKey`, `nonFilterableMetadataKeys`,
   * `tags`, `encryptionConfiguration.kmsKeyArn`) — and for a `client` supplied
   * together with any option that would configure one, which it would silently
   * override.
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
        this.#scope,
        `config.maxConcurrentBatchCalls must be a positive integer (received ${renderValue(config.maxConcurrentBatchCalls)}).`,
      );
    }
    this.#relevanceScoreFn = config.relevanceScoreFn;
    this.#queryEmbeddings = config.queryEmbeddings;

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
    this.#client = resolveClient(config, this.#scope);

    this.#nonFilterableKeys = nonFilterableKeys({
      dataType: this.dataType,
      distanceMetric: this.distanceMetric,
      pageContentMetadataKey: this.pageContentMetadataKey,
      nonFilterableMetadataKeys: this.nonFilterableMetadataKeys,
    });

    // A key list no index could ever be created with can never be written to
    // any index either, so it is refused here — for every store, including one
    // that only ever reads — rather than only once a write first creates the
    // index. `CreateIndex` re-checks the same rule as defence.
    assertKeysCreatable(this.#nonFilterableKeys, (message) =>
      failNonFilterableKeys(this.pageContentMetadataKey, message),
    );

    this.#lifecycle = createIndexLifecycle(
      {
        client: this.#client,
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

  /**
   * The store type `@langchain/core` records on traces and retriever tags.
   *
   * @returns `'amazonS3Vectors'`, stable for `1.x`
   * @throws Nothing.
   */
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
   * @throws {S3VectorsError} Before any request: `VALIDATION` for mismatched
   * counts, a malformed or repeated id, a bad batch size, a document or metadata
   * S3 Vectors cannot store, or a vector it cannot store (not an array, a
   * dimension outside 1–4096, a non-finite component, zero norm on a cosine
   * index); `INDEX_CONFIG_MISMATCH` when vectors anywhere in the input differ in
   * dimension; `ABORTED` for a fired signal. Each refusal about one element
   * carries `context.recordIndex` — its position in your input — and, where
   * known, `context.recordId`. Nothing is written for an input that fails these.
   * After the first batch's `GetIndex`, when the index already exists:
   * `INDEX_CONFIG_MISMATCH` when its non-filterable keys disagree with this
   * store's configuration.
   * Otherwise, on a failure partway through a multi-batch write, the error's
   * `context.writtenIds` lists every id durably written before it and
   * `context.attemptedIds` every id the call resolved — check them before
   * retrying, especially for auto-generated ids, which would otherwise be
   * impossible to find or reconcile again.
   */
  async addVectors(
    vectors: number[][],
    documents: DocumentInterface[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<string[]> {
    assertOptionsBag('addVectors', this.#scope, options);
    // No signal check here: it belongs after `addVectors()`'s own input
    // validation, not before it, so an invalid call with a fired signal is
    // VALIDATION rather than ABORTED. The action checks it in the right place.
    return await addVectors({
      vectors,
      documents,
      ids: options?.ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal: options?.signal,
      writeConfig: this.#writeConfig,
      putBatch: this.#putBatch.bind(this),
      ...this.#scope,
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
   * @throws {S3VectorsError} Before any embedding call or request: `VALIDATION`
   * for a mismatched id count, a malformed or repeated id, a bad batch size, or
   * a document or metadata S3 Vectors cannot store, carrying `context.recordIndex`
   * and, where known, `context.recordId`; `ABORTED` for an already-fired signal,
   * checked only once every input check above has passed. `EMBEDDINGS_MISSING`
   * when no model is configured is checked only once the input is valid,
   * un-aborted, and non-empty — `addDocuments([])` on a model-less store
   * resolves `[]` rather than raising it. For the first batch alone, after it is
   * embedded and before any `PutVectors` — so still nothing written — when the
   * index already exists: `INDEX_CONFIG_MISMATCH` when its non-filterable keys
   * disagree with this store's configuration. For a batch the model has
   * embedded, before it is written: `VALIDATION` when the model returns
   * something other than one storable vector per document, or
   * `INDEX_CONFIG_MISMATCH` when that batch's vectors disagree on dimension.
   * A model that throws surfaces as
   * `UNEXPECTED_ERROR`. On any failure after the first batch started, the
   * error's `context.writtenIds` lists every id durably written before it and
   * `context.attemptedIds` every id the call resolved. A failure stops further
   * batches from being embedded or written, and is thrown only after every
   * `PutVectors` call already in flight has settled, so `writtenIds` is complete.
   */
  async addDocuments(
    documents: DocumentInterface[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<string[]> {
    assertOptionsBag('addDocuments', this.#scope, options);
    return await addDocuments({
      documents,
      ids: options?.ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal: options?.signal,
      // Resolved lazily, inside the action, so an invalid or empty call never
      // asks for a model — a store built with none can still tell VALIDATION
      // and "nothing to do" apart from EMBEDDINGS_MISSING.
      getEmbeddings: () => this.#getIndexEmbeddings(),
      writeConfig: this.#writeConfig,
      putBatch: this.#putBatch.bind(this),
      ...this.#scope,
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
   * @throws {S3VectorsError} `VALIDATION` for `k`, the filter, a `signal` that
   * is not an `AbortSignal`, or a query vector S3 Vectors would refuse (not an
   * array, a dimension outside 1–4096, a non-finite component, zero norm on a
   * cosine index), before any request; `ABORTED` when the signal fires, before
   * or during a request; `INDEX_CONFIG_MISMATCH` when the index's distance
   * metric differs from the store's; `AWS_INVALID_RESPONSE` for a response that
   * is not an object, names no recognisable metric, holds `vectors` that are
   * not a list of objects, or holds a result without a usable numeric
   * `distance` — this always requests `returnDistance: true`, so a missing
   * value means a malformed response, and it fails closed instead of defaulting
   * to the best possible score; `QUERY_PAGE_LIMIT_EXCEEDED` when the 1,000-page
   * ceiling is reached with pages outstanding and fewer than `k` results;
   * `VALIDATION` for result metadata `structuredClone` cannot copy, reachable
   * only from a non-conforming client; otherwise the class the `QueryVectors`
   * failure maps to, carrying `pagesScanned` and `resultsCollected` when a page
   * after the first failed.
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType'],
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    return await searchByVector({
      client: this.#client,
      operation: 'similaritySearchVectorWithScore',
      distanceMetric: this.distanceMetric,
      queryVector: query,
      k,
      filter,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal,
      ...this.#scope,
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
   * Validates `k`, the filter and the callbacks slot before embedding — a
   * rejected argument shouldn't cost a billable `embedQuery` call first.
   *
   * @param _callbacks - Accepted and ignored, per `@langchain/core`'s
   * `VectorStore` signature. Passing an `AbortSignal` here throws a coded
   * `VALIDATION` error rather than silently running the search uncancelled —
   * the signal belongs in the fifth argument.
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   * @returns `[document, distance]` pairs, nearest first, at most `k` of them.
   * Fewer than `k` is normal for a filtered search over a sparse index.
   * @throws {S3VectorsError} `VALIDATION` for a query that is not a string,
   * `k`, the filter, a signal in the callbacks slot or a `signal` that is not an
   * `AbortSignal`, and `ABORTED` for a signal that has already fired — all
   * before the billable `embedQuery`; `EMBEDDINGS_MISSING` when no query-side
   * model is configured; `UNEXPECTED_ERROR` when that model throws; otherwise
   * whatever {@link similaritySearchVectorWithScore} raises for the embedded
   * query.
   */
  override async similaritySearchWithScore(
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
    rejectSignalInCallbacksSlot('similaritySearchWithScore', this.#scope, _callbacks);
    return await this.#textSearch('similaritySearchWithScore', query, k, filter, signal);
  }

  /**
   * The text-search path all three public text searches share.
   *
   * @param operation - The public method the caller invoked. Passed down so
   * every error names that, not this helper and not whichever sibling
   * happened to delegate here — `context.operation` is how a caller finds the
   * call site, and a delegate's name sends them to the wrong one.
   * @param query - The text to embed and search with
   * @param k - Results wanted
   * @param filter - Metadata filter
   * @param signal - Abort, checked before the billable embed call
   * @returns `[document, distance]` pairs, nearest first
   * @throws {S3VectorsError} `VALIDATION` for a query that is not a string,
   * `k`, the filter or a `signal` that is not an `AbortSignal`, `ABORTED` for
   * an already-fired signal — all before `embedQuery`, which is billable and
   * cannot be cancelled; `EMBEDDINGS_MISSING` when no query-side model is
   * configured; `UNEXPECTED_ERROR` when that model throws; otherwise whatever
   * the vector search raises.
   */
  async #textSearch(
    operation: string,
    query: string,
    k: number,
    filter: this['FilterType'] | undefined,
    signal: AbortSignal | undefined,
  ): Promise<[Document, number][]> {
    // Everything cheap and synchronous runs before the billable — and
    // uncancellable — embedQuery call: an invalid k, an invalid filter, or a
    // signal that already fired should not cost an embedding round trip
    // before failing.
    assertQueryText(operation, this.#scope, query);
    assertK(operation, this.#scope, k);
    validateFilter(filter, operation, this.#scope);
    // embedQuery has no signal support (LangChain's EmbeddingsInterface
    // doesn't accept one), so it can't self-cancel the way an AWS call does —
    // check explicitly. Only the QueryVectors call after it can be cancelled
    // mid-flight.
    this.#checkAborted(operation, signal);
    const queryVector = await this.#embedQuery(operation, query);
    return await searchByVector({
      client: this.#client,
      operation,
      distanceMetric: this.distanceMetric,
      queryVector,
      k,
      filter,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal,
      ...this.#scope,
    });
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
   * @returns The documents, nearest first, at most `k` of them.
   * @throws {S3VectorsError} Whatever {@link similaritySearchWithScore}
   * raises; this adds no failure of its own beyond rejecting a signal in the
   * callbacks slot.
   */
  override async similaritySearch(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    // Checked here as well as in the delegate: this forwards `undefined`
    // into that slot, so the delegate's own check can never see what this
    // caller actually passed.
    rejectSignalInCallbacksSlot('similaritySearch', this.#scope, _callbacks);
    return (await this.#textSearch('similaritySearch', query, k, filter, signal)).map(
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
   * @returns `[document, score]` pairs, most relevant first, at most `k` of
   * them. Higher is better, which is the opposite direction from the raw
   * distance {@link similaritySearchWithScore} returns.
   * @throws {S3VectorsError} `VALIDATION` on a euclidean index with no
   * `relevanceScoreFn`, before the billable `embedQuery` — there is no correct
   * conversion to fall back to; `UNEXPECTED_ERROR` when `relevanceScoreFn`
   * throws; otherwise whatever {@link similaritySearchWithScore} raises.
   */
  async similaritySearchWithRelevanceScores(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    rejectSignalInCallbacksSlot('similaritySearchWithRelevanceScores', this.#scope, callbacks);
    const scoreFn = this.#selectRelevanceScoreFn();
    const results = await this.#textSearch(
      'similaritySearchWithRelevanceScores',
      query,
      k,
      filter,
      signal,
    );
    return results.map(([doc, distance]) => [doc, this.#score(scoreFn, distance)]);
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
   *   (`@langchain/core@1.2.11` `dist/vectorstores.d.ts:528`) and passes no
   *   config to `_getRelevantDocuments`, so a retriever-scoped signal has no
   *   other route to the underlying requests. Absent behaves exactly as core's
   *   three-parameter call.
   *
   * @returns At most `k` documents, most relevant first, each distinct. Fewer
   * than `k` when the index holds fewer candidates than asked for.
   * @throws {S3VectorsError} `VALIDATION` for a query that is not a string, a
   * missing options object, `k`, `fetchK`, `lambda`, the filter, a signal in
   * the callbacks slot or a `signal` that is not an `AbortSignal`, and
   * `ABORTED` for a signal that has already fired, before the billable
   * `embedQuery`; `VALIDATION` for an embedded query vector S3 Vectors would
   * refuse (not an array, a dimension outside 1–4096, a non-finite component,
   * zero norm on a cosine index), before any request; `EMBEDDINGS_MISSING` when
   * no query-side model is configured; `UNEXPECTED_ERROR` when that model
   * throws; otherwise whatever the search and fetch raise.
   */
  override async maxMarginalRelevanceSearch(
    query: string,
    options: MaxMarginalRelevanceSearchOptions<this['FilterType']>,
    callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    rejectSignalInCallbacksSlot('maxMarginalRelevanceSearch', this.#scope, callbacks);
    assertQueryText('maxMarginalRelevanceSearch', this.#scope, query);
    assertOptionsBag('maxMarginalRelevanceSearch', this.#scope, options);
    if (options === undefined || options === null) {
      throw validationError(
        'maxMarginalRelevanceSearch',
        this.#scope,
        'maxMarginalRelevanceSearch requires an options object; `k`, `fetchK` and `lambda` ' +
          'each have a default, but the argument itself is not optional.',
      );
    }
    const k = options.k ?? 4;
    const fetchK = options.fetchK ?? 20;
    const lambda = options.lambda ?? 0.5;

    // Before the embed, not after it. `mmrSearch` checks these too and checks
    // them first, but the store calls it *after* embedding — so an impossible
    // `k` cost a billable, uncancellable round trip before failing, which is
    // exactly what this method's own documentation promised it would not.
    assertMmrParameters(k, fetchK, lambda, 'maxMarginalRelevanceSearch', this.#scope);
    validateFilter(options.filter, 'maxMarginalRelevanceSearch', this.#scope);

    // embedQuery has no signal support, so it cannot self-cancel — check
    // before spending a billable, uncancellable call.
    this.#checkAborted('maxMarginalRelevanceSearch', signal);
    const queryVector = await this.#embedQuery('maxMarginalRelevanceSearch', query);

    return mmrSearch({
      client: this.#client,
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: this.distanceMetric,
      queryVector,
      k,
      fetchK,
      lambda,
      filter: options.filter,
      pageContentMetadataKey: this.pageContentMetadataKey,
      maxConcurrent: this.maxConcurrentBatchCalls,
      signal,
      ...this.#scope,
    });
  }

  /**
   * Delete vectors by id.
   *
   * @remarks
   * This removes vectors and nothing else. `@langchain/core` describes the
   * interface method as "remove stored documents by ID", and S3 Vectors has no
   * truncate operation, so there is no reading of `delete` under which it
   * destroys an index. That is {@link deleteIndex}, which has to be named to
   * be called — a flag meaning "everything" is how a production index gets
   * destroyed by a typo.
   *
   * Deleting an id that is not there succeeds: AWS accepts absent keys
   * (`docs/evidence/delete-absent.md`), so a blind retry of the full list
   * after an ambiguous network failure is safe.
   *
   * @param params - Deletion parameters
   * @param params.ids - The vector ids to delete. Required.
   * @param params.batchSize - Ids per `DeleteVectors` call, 1–500 (default 500)
   * @param params.signal - Abort an in-progress delete. Cancels the call in
   * flight and stops further batches from starting.
   * @returns Nothing. A complete delete removed everything asked for; a
   * partial one reports what it managed via `context.deletedIds`.
   * @throws {S3VectorsError} `VALIDATION` when `ids` is missing or not an
   * array, when an id is not a string of 1–1024 characters or not well-formed
   * UTF-16, when an id is repeated (`DeleteVectors` refuses a repeated key), when
   * the legacy `deleteAll` flag is passed, or for a batch size outside 1–500 —
   * a per-id refusal carrying `recordIndex` and, for a string, `recordId`;
   * `ABORTED` for a fired signal; otherwise the class the `DeleteVectors` failure
   * maps to, carrying `context.deletedIds`.
   */
  override async delete(params: S3VectorsDeleteParams): Promise<void> {
    assertOptionsBag('delete', this.#scope, params);
    await deleteVectors({
      client: this.#client,
      ...(params as { ids: string[] }),
      maxConcurrent: this.maxConcurrentBatchCalls,
      ...this.#scope,
    });
  }

  /**
   * Delete the index itself.
   *
   * @remarks
   * This calls `DeleteIndex`. It removes the **index**, not its contents:
   * everything attached to it goes too — its encryption configuration, its
   * tags, its non-filterable-metadata configuration — and any IAM statement
   * scoped to the index ARN is left pointing at a resource that no longer
   * exists. Because an index's configuration is immutable, what a later write
   * re-creates under the same name is a different index that happens to share
   * it: `dimension` comes from the first vector written, and the rest from
   * *this store's* configuration, which may not be how the original was
   * provisioned.
   *
   * It is idempotent: deleting an index that is already gone resolves cleanly,
   * so a retry after an ambiguous network failure is safe.
   *
   * If the index must survive, delete vectors by id instead — S3 Vectors has
   * no truncate operation.
   *
   * @param options - Optional settings
   * @param options.signal - Abort the deletion. An already-fired signal
   * rejects before any request; one that fires while an index creation is
   * being awaited ends this caller's wait without cancelling that shared work.
   * @returns Nothing.
   * @throws {S3VectorsError} `ABORTED` for a fired signal; otherwise the class
   * the `DeleteIndex` failure maps to. A missing index is not a failure.
   */
  async deleteIndex(options?: S3VectorsDeleteIndexParams): Promise<void> {
    assertOptionsBag('deleteIndex', this.#scope, options);
    await this.#lifecycle.deleteIndex(options?.signal, 'deleteIndex');
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
   * @throws {S3VectorsError} `VALIDATION`, before any request, for a non-array
   * `ids`, an id that is not a string of 1–1024 characters or not well-formed
   * UTF-16 (carrying `recordIndex` and, for a string, `recordId`), or a bad batch
   * size. `ABORTED` for a fired signal. Otherwise, if a `GetVectors` batch call
   * fails — **not** if an id is absent, which is reported as `undefined` in that
   * id's slot, as the remarks above describe — the class it maps to, with
   * `context.foundIds` listing every id already confirmed found before the
   * failure, including one found by a concurrent batch that succeeded alongside
   * the one that failed, so a caller doesn't have to re-fetch everything from
   * scratch.
   */
  async getByIds(
    ids: string[],
    options?: { batchSize?: number; signal?: AbortSignal },
  ): Promise<(Document | undefined)[]> {
    assertOptionsBag('getByIds', this.#scope, options);
    return await getByIds({
      client: this.#client,
      ids,
      batchSize: options?.batchSize,
      maxConcurrent: this.maxConcurrentBatchCalls,
      pageContentMetadataKey: this.pageContentMetadataKey,
      signal: options?.signal,
      ...this.#scope,
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
  async *listDocuments(options?: S3VectorsListParams): AsyncGenerator<Document> {
    // A generator, not a plain method, so a malformed bag fails on the first
    // `next()` — exactly where an out-of-range `pageSize` fails. Throwing
    // synchronously from a method documented to return a generator would make
    // one of the two validations escape a `try` wrapped around the loop.
    assertOptionsBag('listDocuments', this.#scope, options);
    yield* listDocuments({
      client: this.#client,
      operation: 'listDocuments',
      pageContentMetadataKey: this.pageContentMetadataKey,
      pageSize: options?.pageSize,
      signal: options?.signal,
      ...this.#scope,
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
  async *listVectors(options?: S3VectorsListParams): AsyncGenerator<S3VectorsRecord> {
    // See {@link listDocuments} for why this is a generator.
    assertOptionsBag('listVectors', this.#scope, options);
    yield* listVectors({
      client: this.#client,
      operation: 'listVectors',
      pageContentMetadataKey: this.pageContentMetadataKey,
      pageSize: options?.pageSize,
      signal: options?.signal,
      ...this.#scope,
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
   * `_getRelevantDocuments` (`@langchain/core@1.2.11`
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
   * @throws Nothing. Building a retriever issues no request and validates
   * nothing: its `k` and `filter` are checked when it runs a search, by the
   * same guards a direct call goes through.
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
   * Create a store, embed the given texts and add them to it.
   *
   * @param texts - The texts to store, one document each
   * @param metadatas - One object per text, a single object broadcast to every
   * text, or omitted entirely — which gives each document `{}`
   * @param embeddings - The model used to embed them
   * @param config - The store configuration, plus the `ids`, `batchSize` and
   * `signal` the write takes
   * @returns The constructed store, after the write
   * @throws {S3VectorsError} Every error names `fromTexts` as its operation.
   * `VALIDATION` when `texts` is not an array or the metadata array's length
   * disagrees with it; otherwise whatever {@link fromDocuments} raises, with its
   * code, cause, `awsCommand`, stack and — once the store was constructed —
   * `context.instance` unchanged.
   */
  static override async fromTexts(
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
    const fail = (message: string, record?: RecordRef): never => {
      throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
        operation: 'fromTexts',
        ...record,
      });
    };
    texts.forEach((text: unknown, index: number) => {
      if (typeof text !== 'string') {
        fail(`texts[${index}] must be a string (received ${renderValue(text)}).`, {
          recordIndex: index,
        });
      }
    });
    if (Array.isArray(metadatas)) {
      if (metadatas.length !== texts.length) {
        fail(
          `Number of metadatas (${metadatas.length}) must match number of texts (${texts.length})`,
        );
      }
      metadatas.forEach((metadata: unknown, index: number) => {
        if (metadata !== undefined && metadata !== null && !isObjectLike(metadata)) {
          fail(`metadatas[${index}] must be an object (received ${renderValue(metadata)}).`, {
            recordIndex: index,
          });
        }
      });
    } else if (metadatas !== undefined && metadatas !== null && !isObjectLike(metadatas)) {
      // Not an array, so it would be broadcast to every document — and a string
      // broadcast that way was spread into one metadata key per character and
      // written.
      fail(
        `metadatas must be an array of objects, or a single object to apply to every text ` +
          `(received ${renderValue(metadatas)}).`,
      );
    }

    const metaArray = Array.isArray(metadatas) ? metadatas : texts.map(() => metadatas);

    // `?? {}` rather than a non-null assertion: an untyped caller may omit
    // `metadatas` entirely, and this pins the empty-object answer here instead
    // of leaning on what `Document` happens to do with `undefined`.
    const documents = texts.map(
      (text, i) => new Document({ pageContent: text, metadata: metaArray[i] ?? {} }),
    );

    try {
      return await AmazonS3Vectors.fromDocuments(documents, embeddings, config);
    } catch (error: unknown) {
      throw attachOperation(error, 'fromTexts');
    }
  }

  /**
   * Create a store and add the given documents to it.
   *
   * @param docs - The documents to store
   * @param embeddings - The model used to embed them
   * @param config - The store configuration, plus the `ids`, `batchSize` and
   * `signal` the write takes
   * @returns The constructed store, after the write
   * @throws {S3VectorsError} Every error names `fromDocuments` as its operation,
   * with the code, cause, `awsCommand` and stack of whatever failed. What the
   * constructor refuses, before any request; otherwise whatever
   * {@link addDocuments} raises. If the write fails — including partway
   * through a multi-batch write — `context.instance` carries the constructed
   * (and possibly partially-written) store, so the caller can act on
   * `context.writtenIds` without reconstructing an equivalent instance from the
   * same embeddings/config.
   */
  static override async fromDocuments(
    docs: DocumentInterface[],
    embeddings: EmbeddingsInterface,
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<AmazonS3Vectors> {
    let instance: AmazonS3Vectors;
    try {
      instance = new AmazonS3Vectors(embeddings, config);
    } catch (error: unknown) {
      // No store, so no bucket or index this package has validated to name.
      throw attachOperation(error, 'fromDocuments');
    }
    try {
      await instance.addDocuments(docs, {
        // Omitted rather than passed as `undefined`, so the options bag says
        // "not given" the way an absent property does.
        ...(config.ids === undefined ? {} : { ids: config.ids }),
        ...(config.batchSize === undefined ? {} : { batchSize: config.batchSize }),
        ...(config.signal === undefined ? {} : { signal: config.signal }),
      });
    } catch (error: unknown) {
      throw attachInstance(error, 'fromDocuments', instance.#scope, instance);
    }
    return instance;
  }

  // ── Protected / internal helpers ──────────────────────────────────────

  /**
   * The distance-to-relevance conversion this store uses.
   *
   * @internal Called by `@langchain/core`'s
   * `similaritySearchWithRelevanceScores`, not by application code.
   *
   * @returns The configured `relevanceScoreFn`, else `cosineRelevanceScoreFn`
   * for a cosine index
   * @throws {S3VectorsError} `VALIDATION` for a euclidean index with no
   * `relevanceScoreFn`: euclidean distance is unbounded above, so there is no
   * correct fixed conversion to fall back to.
   */
  #selectRelevanceScoreFn(): (distance: number) => number {
    return selectRelevanceScoreFn(this.distanceMetric, this.#scope, this.#relevanceScoreFn);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** Bind this store's client and index lifecycle to one {@link putBatch} call. */
  #putBatch(
    operation: string,
    batchOffset: number,
    records: readonly WriteRecord[],
    vectors: readonly number[][],
    signal?: AbortSignal,
  ): Promise<void> {
    return putBatch({
      client: this.#client,
      operation,
      batchOffset,
      records,
      vectors,
      ensureIndex: this.createIndexIfNotExist
        ? (dimension, abort) => this.#lifecycle.ensureExists(dimension, abort, operation)
        : undefined,
      onIndexAbsent: () => {
        this.#lifecycle.markAbsent();
      },
      signal,
      ...this.#scope,
    });
  }

  /**
   * Embed a query, surfacing a provider failure as a coded error.
   *
   * The write path has always done this: an `embedDocuments` that throws comes
   * back as `UNEXPECTED_ERROR`. Every read path let the same failure through
   * untouched, so the most likely production failure on a read — the embeddings
   * provider rate-limiting or falling over — was the one a `catch` branching on
   * `isS3VectorsError` would miss.
   *
   * An `EMBEDDINGS_MISSING` raised by the lookup passes through unchanged:
   * `wrapCallerError` returns an error that is already ours.
   */
  async #embedQuery(operation: string, query: string): Promise<number[]> {
    try {
      return await this.#getQueryEmbeddings(operation).embedQuery(query);
    } catch (error: unknown) {
      throw wrapCallerError(error, { operation, ...this.#scope });
    }
  }

  /**
   * Apply the relevance-score conversion, surfacing a failure as a coded error.
   *
   * `relevanceScoreFn` is caller-supplied code called once per result, so it
   * fails the same way any other caller code does and is wrapped the same way.
   */
  #score(scoreFn: (distance: number) => number, distance: number): number {
    try {
      return scoreFn(distance);
    } catch (error: unknown) {
      throw wrapCallerError(error, {
        operation: 'similaritySearchWithRelevanceScores',
        ...this.#scope,
      });
    }
  }

  /**
   * Return the query-embedding model, falling back to the indexing model.
   *
   * @param operation - The public method the caller invoked, named in the error
   * @throws {S3VectorsError} `EMBEDDINGS_MISSING` when neither model is configured
   */
  #getQueryEmbeddings(operation: string): EmbeddingsInterface {
    const emb = this.#queryEmbeddings ?? this.embeddings;
    if (isStubEmbeddings(emb)) {
      throw new S3VectorsError(
        'No embedding model available for queries. ' +
          'Provide `embeddings` or `queryEmbeddings` in the config.',
        S3VectorsErrorCode.EMBEDDINGS_MISSING,
        { operation, ...this.#scope },
      );
    }
    return emb;
  }

  /** Return the indexing-embedding model, throwing a coded error if none is configured. */
  #getIndexEmbeddings(): EmbeddingsInterface {
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
  #checkAborted(operation: string, signal: AbortSignal | undefined): void {
    checkAborted(operation, signal, {
      vectorBucketName: this.vectorBucketName,
      indexName: this.indexName,
    });
  }
}
