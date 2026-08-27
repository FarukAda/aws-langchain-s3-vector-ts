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
import { VectorStore, type MaxMarginalRelevanceSearchOptions } from '@langchain/core/vectorstores';
import type { DocumentType as __DocumentType } from '@smithy/types';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';
import { chunk } from './shared/batching.js';
import { isAbortError } from './shared/errors/aws-abort.js';
import { isAwsConflictException } from './shared/errors/aws-conflict.js';
import { isAwsNotFoundException } from './shared/errors/aws-not-found.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { toError, wrapAwsError } from './shared/errors/wrap-error.js';
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
 * True for a plain key/value filter object — an object literal or an
 * `Object.create(null)` dictionary. False for arrays, `Map`/`Set`, `Date`,
 * class instances, and primitives.
 */
function isPlainFilterObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** "a"/"an" for the given word, so error messages don't read "a Error instance". */
function articleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** Describe a rejected filter value for the validation error message. */
function describeFilterValue(value: unknown): string {
  const type = typeof value;
  if (type !== 'object') return `${articleFor(type)} ${type}`;
  const ctorName = (value as { constructor?: { name?: string } })?.constructor?.name;
  return ctorName && ctorName !== 'Object'
    ? `${articleFor(ctorName)} ${ctorName} instance`
    : 'a non-plain object';
}

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
    existing: { dimension: number; distanceMetric: DistanceMetric } | null;
    epoch: number;
  }> | null = null;

  /**
   * Bumped every time {@link delete}'s `deleteAll` branch tears down the
   * whole index. {@link _ensureIndexExists} captures this counter's value
   * at the moment it actually creates a fresh memo (not per-joiner — a
   * caller that later joins an already-in-flight memo inherits the epoch
   * that memo started under), and the `createIndexIfNotExist: false` path
   * in {@link _validateBeforeWrite} captures it the same way before its own
   * `GetIndex` call. {@link _validateBeforeWrite} only commits a result
   * into {@link _validatedIndexInfo} if this counter is still unchanged
   * once that result comes back — so a `deleteAll` landing anywhere
   * between a check starting and a write reading its result discards the
   * now-stale result instead of letting it silently resurrect the clear.
   */
  private _indexEpoch = 0;

  /**
   * Cached dimension/metric of this instance's index, populated by the
   * first successful write (via {@link _validateBeforeWrite}) regardless
   * of {@link createIndexIfNotExist} — every write after that validates
   * against this cache instead of paying for another `GetIndex` round
   * trip, not just memoized per-call like {@link _ensureIndexPromise}.
   * Cleared by {@link delete} when the whole index is deleted, so a later
   * write re-fetches instead of validating against a now-stale index —
   * see {@link _indexEpoch} for how a concurrent write's in-flight result
   * is kept from undoing that clear.
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

    const isS3VectorsClient =
      config.client !== undefined &&
      Object.prototype.isPrototypeOf.call(S3VectorsClient.prototype, config.client);

    if (config.client && !isS3VectorsClient) {
      console.warn(
        '[AmazonS3Vectors] config.client was provided but is not an instance of S3VectorsClient ' +
          '(from "@aws-sdk/client-s3vectors"); ignoring it and building a new client from ' +
          'region/credentials/endpoint instead.',
      );
    }

    this._client =
      config.client && isS3VectorsClient
        ? config.client
        : new S3VectorsClient({
            region: config.region,
            credentials: config.credentials,
            endpoint: config.endpoint,
            maxAttempts: config.maxAttempts,
            retryMode: config.retryMode,
          });
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
   * @throws Error if counts of vectors, documents, or IDs don't match. On a
   * partial-write failure (a later batch fails after earlier ones already
   * committed), the thrown {@link S3VectorsError}'s `context.writtenIds`
   * lists every id that was durably written before the failure — check it
   * before retrying, especially for auto-generated ids, which would
   * otherwise be impossible to find or reconcile again.
   */
  async addVectors(
    vectors: number[][],
    documents: Document[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
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
    const ids = options?.ids ?? documents.map((doc) => doc.id ?? randomUUID().replace(/-/g, ''));
    if (ids.length !== vectors.length) {
      throw this._validationError(
        'addVectors',
        `Number of IDs (${ids.length}) must match number of vectors (${vectors.length})`,
      );
    }
    if (vectors.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addVectors', batchSize, MAX_PUT_BATCH_SIZE);
    const signal = options?.signal;

    await this._runBatchesConcurrently(
      'addVectors',
      chunk(vectors, batchSize),
      ids,
      (batch, offset) =>
        this._ensureIndexAndPut(
          'addVectors',
          offset,
          batch,
          documents.slice(offset, offset + batch.length),
          ids.slice(offset, offset + batch.length),
          signal,
        ),
    );

    return ids;
  }

  /**
   * Embed documents and store them in the vector index.
   *
   * @remarks
   * Documents are embedded **per batch, one batch at a time** to keep peak
   * embedding-provider load low for large document sets (matching the
   * Python `langchain-aws` implementation) — `embedDocuments` is never
   * called concurrently for two batches, since most embedding providers
   * rate-limit aggressively and this library gives no retry/backoff
   * guarantee for that call. Once a batch is embedded, its `PutVectors`
   * call is dispatched without waiting for it to finish before embedding
   * the next batch, up to 10 `PutVectors` calls in flight at once — AWS's
   * own SDK already retries throttling there. Peak memory for in-flight
   * vectors is therefore bounded by roughly `10 × batchSize`, not
   * `batchSize` alone, in exchange for meaningfully higher write
   * throughput on large ingests.
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
   * @throws Error if count of IDs doesn't match count of documents. On a
   * partial-write failure (a later batch fails after earlier ones already
   * committed), the thrown {@link S3VectorsError}'s `context.writtenIds`
   * lists every id that was durably written before the failure — check it
   * before retrying, especially for auto-generated ids, which would
   * otherwise be impossible to find or reconcile again.
   */
  async addDocuments(
    documents: Document[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
  ): Promise<string[]> {
    // Checked before the empty-batch short-circuit below — a caller passing
    // a stale/mismatched `ids` array alongside an empty `documents` array is
    // still a real caller mistake and shouldn't be silently swallowed into
    // a no-op success.
    const ids = options?.ids ?? documents.map((doc) => doc.id ?? randomUUID().replace(/-/g, ''));
    if (ids.length !== documents.length) {
      throw this._validationError(
        'addDocuments',
        `Number of IDs (${ids.length}) must match number of documents (${documents.length})`,
      );
    }
    if (documents.length === 0) return [];

    const batchSize = options?.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
    this._validateBatchSize('addDocuments', batchSize, MAX_PUT_BATCH_SIZE);
    const signal = options?.signal;

    const embeddings = this._getIndexEmbeddings();
    const embedBatch = async (batchDocs: Document[]): Promise<number[][]> => {
      const batchVectors = await embeddings.embedDocuments(batchDocs.map((d) => d.pageContent));

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
      return batchVectors;
    };
    const putBatch = (batch: Document[], offset: number, batchVectors: number[][]) =>
      this._ensureIndexAndPut(
        'addDocuments',
        offset,
        batchVectors,
        batch,
        ids.slice(offset, offset + batch.length),
        signal,
      );

    // documents.length === 0 already returned above, so chunk() here always
    // yields at least one non-empty batch — batches[0] is never undefined.
    const batches = chunk(documents, batchSize);
    const firstBatch = batches[0]!;

    // The first batch is embedded and put alone, awaited before anything
    // else starts — it's the one that creates or validates the index
    // (batchOffset === 0 inside _ensureIndexAndPut), so every later batch
    // depends on it having already happened. writtenIds tracks every id
    // confirmed durably written so far, so a failure anywhere below can
    // report exactly what's already landed instead of losing that
    // information the moment the error propagates.
    let writtenIds: string[] = [];
    // embedDocuments has no signal support, so it can't self-cancel the
    // way _send()'s AWS calls do — check explicitly before spending an
    // expensive, uncancellable call on a batch nobody wants anymore.
    this._checkAborted('addDocuments', signal);
    try {
      await putBatch(firstBatch, 0, await embedBatch(firstBatch));
      writtenIds = ids.slice(0, firstBatch.length);
    } catch (error: unknown) {
      throw this._attachPartialIds(error, 'addDocuments', 'writtenIds', writtenIds);
    }

    const rest: { batch: Document[]; offset: number }[] = [];
    let offset = firstBatch.length;
    for (const batch of batches.slice(1)) {
      rest.push({ batch, offset });
      offset += batch.length;
    }

    for (const group of chunk(rest, MAX_CONCURRENT_BATCH_CALLS)) {
      // embedDocuments has no signal support, so it can't self-cancel the
      // way _send()'s AWS calls do — check explicitly before spending an
      // expensive, uncancellable call on a batch nobody wants anymore.
      this._checkAborted('addDocuments', signal);

      // Embed every batch in the group sequentially — embedDocuments is
      // never called concurrently for two batches, since most embedding
      // providers rate-limit aggressively and this library gives no
      // retry/backoff guarantee for that call — then dispatch the whole
      // group's PutVectors calls together, since AWS's SDK already
      // retries throttling there. embedBatch can throw here (a raw error
      // from the caller's embeddings model, not wrapped by _send); caught
      // below alongside a PutVectors failure so both report writtenIds.
      const withVectors: { batch: Document[]; offset: number; vectors: number[][] }[] = [];
      try {
        for (const { batch, offset: batchOffset } of group) {
          withVectors.push({ batch, offset: batchOffset, vectors: await embedBatch(batch) });
        }
      } catch (error: unknown) {
        throw this._attachPartialIds(error, 'addDocuments', 'writtenIds', writtenIds);
      }

      // allSettled, not all — waiting out every sibling in the group
      // before reporting a failure is what makes writtenIds accurate: a
      // slower sibling that succeeds *after* another one rejects would
      // otherwise never make it into the reported set.
      const results = await Promise.allSettled(
        withVectors.map(({ batch, offset: batchOffset, vectors }) =>
          putBatch(batch, batchOffset, vectors).then(() => ({
            offset: batchOffset,
            length: batch.length,
          })),
        ),
      );
      let firstError: unknown;
      let hasError = false;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          writtenIds.push(
            ...ids.slice(result.value.offset, result.value.offset + result.value.length),
          );
        } else if (!hasError) {
          hasError = true;
          firstError = result.reason;
        }
      }
      if (hasError) {
        throw this._attachPartialIds(firstError, 'addDocuments', 'writtenIds', writtenIds);
      }
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
   * @param options.signal - Forwarded to {@link addDocuments}.
   * @returns The IDs assigned to each stored vector
   * @throws Error if count of metadatas doesn't match count of texts
   */
  async addTexts(
    texts: string[],
    metadatas?: Record<string, unknown>[],
    options?: { ids?: string[]; batchSize?: number; signal?: AbortSignal },
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
   * @param signal - Abort an in-progress search. Cancels the `QueryVectors`
   * call currently in flight and stops any further pagination.
   * @returns Array of `[Document, distance]` tuples, ordered by similarity
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType'],
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    const outputVectors = await this._queryVectors(
      'similaritySearchVectorWithScore',
      k,
      {
        queryVector: { float32: query },
        filter: filter as __DocumentType | undefined,
        returnMetadata: true,
        returnDistance: true,
      },
      signal,
    );

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
    _callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    this._validateK('similaritySearchWithScore', k);
    // embedQuery has no signal support (LangChain's EmbeddingsInterface
    // doesn't accept one), so it can't be cancelled mid-call — only the
    // QueryVectors call after it can.
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
   */
  async similaritySearch(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: Callbacks,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    return (await this.similaritySearchWithScore(query, k, filter, undefined, signal)).map(
      ([doc]) => doc,
    );
  }

  /**
   * Return documents most similar to a raw embedding vector (no scores).
   *
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   */
  async similaritySearchByVector(
    embedding: number[],
    k = 4,
    filter?: this['FilterType'],
    signal?: AbortSignal,
  ): Promise<Document[]> {
    const outputVectors = await this._queryVectors(
      'similaritySearchByVector',
      k,
      {
        queryVector: { float32: embedding },
        filter: filter as __DocumentType | undefined,
        returnMetadata: true,
        returnDistance: false,
      },
      signal,
    );

    return outputVectors.map((v) => createDocument(v, this.pageContentMetadataKey));
  }

  /**
   * Run a text-based similarity search and return documents with
   * *relevance scores* (higher is better), converted from S3 Vectors'
   * raw distance via {@link _selectRelevanceScoreFn}.
   *
   * @param signal - Abort an in-progress search (see {@link similaritySearchVectorWithScore}).
   */
  async similaritySearchWithRelevanceScores(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    signal?: AbortSignal,
  ): Promise<[Document, number][]> {
    const scoreFn = this._selectRelevanceScoreFn();
    const results = await this.similaritySearchWithScore(query, k, filter, undefined, signal);
    return results.map(([doc, distance]) => [doc, scoreFn(distance)]);
  }

  /**
   * Maximal Marginal Relevance (MMR) search — **not supported** by this store.
   *
   * @remarks
   * `AmazonS3Vectors` intentionally does not implement real MMR, matching
   * the Python `langchain-aws` reference — use metadata pre-filtering or
   * client-side re-ranking if you need result diversity. Unlike Python's
   * `VectorStore.max_marginal_relevance_search` (a concrete base-class
   * method that raises `NotImplementedError` by default), `@langchain/core`'s
   * JS `VectorStore` only *types* this method as optional with no runtime
   * default — so this store defines it explicitly, purely to throw this
   * library's own coded {@link S3VectorsError} instead of a raw `TypeError`.
   *
   * @throws {S3VectorsError} Always, with code `NOT_IMPLEMENTED`.
   */
  async maxMarginalRelevanceSearch(
    _query: string,
    _options: MaxMarginalRelevanceSearchOptions<this['FilterType']>,
    _callbacks?: Callbacks,
  ): Promise<Document[]> {
    throw new S3VectorsError(
      'maxMarginalRelevanceSearch is not supported by AmazonS3Vectors, matching the Python ' +
        'langchain-aws reference — use metadata pre-filtering or client-side re-ranking if you ' +
        'need result diversity.',
      S3VectorsErrorCode.NOT_IMPLEMENTED,
      {
        operation: 'maxMarginalRelevanceSearch',
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
      },
    );
  }

  /**
   * Delete vectors by ID, or delete the entire index.
   *
   * @param params - Deletion parameters
   * @param params.ids - Vector IDs to delete
   * @param params.batchSize - Number of IDs per `DeleteVectors` call (default: 500)
   * @param params.deleteAll - Must be `true` (with `ids` omitted) to delete the entire index
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
    const ids = params?.ids;
    const deleteAll = params?.deleteAll === true;
    const signal = params?.signal;

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
          { abortSignal: signal },
        ),
      );
      // The index no longer exists — a cached compatibility check against
      // it would validate a later write against a now-deleted index.
      // Bumping the epoch additionally invalidates any write already past
      // this point (mid `_ensureIndexExists`/`_getIndex`), so its
      // now-stale result can't be written into the cache after this clear
      // — see `_indexEpoch`.
      this._validatedIndexInfo = null;
      this._indexEpoch++;
    } else {
      const batchSize = params?.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
      this._validateBatchSize('delete', batchSize, MAX_DELETE_BATCH_SIZE);
      const deletedIds: string[] = [];
      for (const group of chunk(chunk(ids, batchSize), MAX_CONCURRENT_BATCH_CALLS)) {
        // allSettled, not all — waiting out every sibling in the group
        // before reporting a failure is what makes deletedIds accurate: a
        // slower sibling that succeeds *after* another one rejects would
        // otherwise never make it into the reported set.
        const results = await Promise.allSettled(
          group.map((batchIds) =>
            this._send('DeleteVectors', () =>
              this._client.send(
                new DeleteVectorsCommand({
                  vectorBucketName: this.vectorBucketName,
                  indexName: this.indexName,
                  keys: batchIds,
                }),
                { abortSignal: signal },
              ),
            ).then(() => batchIds),
          ),
        );
        let firstError: unknown = null;
        for (const result of results) {
          if (result.status === 'fulfilled') {
            deletedIds.push(...result.value);
          } else if (firstError === null) {
            firstError = result.reason;
          }
        }
        if (firstError !== null) {
          throw this._attachPartialIds(firstError, 'delete', 'deletedIds', deletedIds);
        }
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
  ): Promise<Document[]> {
    const batchSize = options?.batchSize ?? DEFAULT_GET_BATCH_SIZE;
    this._validateBatchSize('getByIds', batchSize, MAX_GET_BATCH_SIZE);
    const signal = options?.signal;
    const batches = chunk(ids, batchSize);

    // Bound the number of in-flight GetVectors calls: process batches in
    // groups, running each group concurrently but awaiting it before
    // starting the next. Order is preserved — groups run in sequence, and
    // results are read back by index, same order as `.map`.
    const docs: Document[] = [];
    const foundIds: string[] = [];
    for (const group of chunk(batches, MAX_CONCURRENT_BATCH_CALLS)) {
      // allSettled, not all — waiting out every sibling in the group before
      // reporting a failure is what makes foundIds (and docs) accurate: a
      // slower sibling that succeeds *after* another one rejects would
      // otherwise never make it into the reported set. Mirrors delete's
      // deletedIds / addVectors's and addDocuments's writtenIds tracking.
      const results = await Promise.allSettled(
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
              { abortSignal: signal },
            ),
          ),
        ),
      );

      let firstError: unknown = null;
      let firstMissingId: string | null = null;
      for (let i = 0; i < group.length; i++) {
        const result = results[i]!;
        if (result.status === 'rejected') {
          if (firstError === null) firstError = result.reason;
          continue;
        }

        const batchIds = group[i]!;
        const outputVectors = (result.value.vectors ?? []) as S3OutputVector[];
        const vectorMap = new Map<string, S3OutputVector>();
        for (const v of outputVectors) {
          vectorMap.set(v.key, v);
        }

        // When duplicate IDs are present, deep-copy metadata to prevent
        // shared-reference mutations (matches Python behaviour).
        const hasDuplicateIds = vectorMap.size < batchIds.length;

        // Preserve input order. Note (but don't stop at) a missing id — a
        // later id in the same batch that IS found must still count toward
        // foundIds even if an earlier one in the batch was missing.
        for (const id of batchIds) {
          const v = vectorMap.get(id);
          if (!v) {
            if (firstMissingId === null) firstMissingId = id;
            continue;
          }
          docs.push(createDocument(v, this.pageContentMetadataKey, hasDuplicateIds, 'getByIds'));
          foundIds.push(id);
        }
      }

      if (firstError !== null) {
        throw this._attachPartialIds(firstError, 'getByIds', 'foundIds', foundIds);
      }
      if (firstMissingId !== null) {
        throw this._attachPartialIds(
          new S3VectorsError(
            `Id '${firstMissingId}' not found in vector store.`,
            S3VectorsErrorCode.NOT_FOUND,
            {
              operation: 'getByIds',
              vectorBucketName: this.vectorBucketName,
              indexName: this.indexName,
            },
          ),
          'getByIds',
          'foundIds',
          foundIds,
        );
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
    config: AmazonS3VectorsConfig & { ids?: string[]; batchSize?: number; signal?: AbortSignal },
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
   *
   * @throws If the write fails — including partway through a multi-batch
   * write — the thrown {@link S3VectorsError}'s `context.instance` carries
   * the constructed (and possibly partially-written) store, so the caller
   * can act on `context.writtenIds` without reconstructing an equivalent
   * instance from the same embeddings/config.
   */
  static async fromDocuments(
    docs: Document[],
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
      throw instance._attachInstance(error, 'fromDocuments');
    }
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
   * Reject a filter that isn't a plain object of metadata conditions
   * before it reaches AWS: an array, a non-plain object (`Map`, `Set`, a
   * class instance), or an empty object are all rejected, each with a
   * distinct message. Confirmed live: S3 Vectors rejects `{}` with an
   * opaque "Invalid filter" `ValidationException` rather than treating it
   * as "no filter" — a caller building a filter dynamically (e.g. only
   * adding conditions when a UI field is set) can easily end up passing
   * `{}` by accident when no condition ends up applying. Omit the
   * `filter` argument entirely (`undefined`, or `null`) to search without
   * filtering.
   */
  private _validateFilter(operation: string, filter: __DocumentType | undefined): void {
    if (filter === undefined || filter === null) return;

    if (Array.isArray(filter)) {
      throw this._validationError(
        operation,
        'filter must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ' +
          'arrays are not a valid filter shape. Omit the filter argument entirely to search ' +
          'without filtering.',
      );
    }

    if (!isPlainFilterObject(filter)) {
      throw this._validationError(
        operation,
        'filter must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ' +
          `received ${describeFilterValue(filter)}, which AWS's filter syntax does not accept.`,
      );
    }

    if (Object.keys(filter).length === 0) {
      throw this._validationError(
        operation,
        'filter cannot be an empty object ({}) — AWS rejects this as an invalid filter. ' +
          'Omit the filter argument entirely to search without filtering.',
      );
    }
  }

  /**
   * Wrap `error` with the ids already confirmed (durably written, durably
   * deleted, or already found, per `key`) before this failure, so a
   * partial-batch-operation failure never silently loses track of progress
   * already made — especially auto-generated write ids, which have no
   * other way to be discovered again afterward. `error` is normally
   * already an {@link S3VectorsError} (every AWS call goes through
   * {@link _send}), but `addDocuments`'s `embedDocuments` call has no such
   * wrapping (it isn't an AWS call), so a raw error from the caller's
   * embeddings model is handled too.
   */
  private _attachPartialIds(
    error: unknown,
    operation: string,
    key: 'writtenIds' | 'deletedIds' | 'foundIds',
    ids: string[],
  ): S3VectorsError {
    const base = isS3VectorsError(error)
      ? error
      : wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
          operation,
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        });
    const phrase =
      key === 'writtenIds'
        ? 'were already durably written'
        : key === 'deletedIds'
          ? 'were already durably deleted'
          : 'were already retrieved';
    const message =
      ids.length > 0
        ? `${base.message} ${ids.length} vector(s) ${phrase} before this failure — see error.context.${key}.`
        : base.message;
    return new S3VectorsError(message, base.code, { ...base.context, [key]: ids }, base.cause);
  }

  /**
   * Wrap `error` from a `fromDocuments`/`fromTexts` factory failure with
   * the instance already constructed (and possibly partially written to),
   * so the caller isn't left to manually reconstruct an equivalent
   * instance from the same embeddings/config just to act on
   * `context.writtenIds`. `error` is already an {@link S3VectorsError} on
   * every real path through `addDocuments`, but an arbitrary error is
   * still wrapped defensively, the same way {@link _attachPartialIds} does.
   */
  private _attachInstance(error: unknown, operation: string): S3VectorsError {
    const base = isS3VectorsError(error)
      ? error
      : wrapAwsError(error, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
          operation,
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        });
    return new S3VectorsError(
      base.message,
      base.code,
      { ...base.context, instance: this },
      base.cause,
    );
  }

  /**
   * Throw an `ABORTED` error if `signal` has already fired. Used before a
   * step the AWS SDK can't cancel on its own (embedding a batch of
   * documents), so an aborted operation doesn't pay for one more expensive,
   * uncancellable call it no longer needs.
   */
  private _checkAborted(operation: string, signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    throw new S3VectorsError(
      `${operation} was aborted.`,
      S3VectorsErrorCode.ABORTED,
      { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
      signal.reason,
    );
  }

  /**
   * Run an AWS call, surfacing any failure as a coded {@link S3VectorsError}.
   * An `AbortSignal` firing before or during the call surfaces as `ABORTED`
   * rather than `AWS_REQUEST_FAILED` — it wasn't AWS that failed, the caller
   * cancelled. The signal itself is threaded into the AWS request by the
   * caller (via `{ abortSignal: signal }` in the `send` closure); the AWS
   * SDK's HTTP handler already rejects immediately, without a network call,
   * for a signal that's already aborted by the time a request is issued.
   */
  private async _send<T>(operation: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error: unknown) {
      const code = isAbortError(error)
        ? S3VectorsErrorCode.ABORTED
        : S3VectorsErrorCode.AWS_REQUEST_FAILED;
      throw wrapAwsError(error, code, {
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
   * score against the wrong metric. Fails closed: confirmed live that
   * `distanceMetric` is present on every response (empty index, filtered
   * to zero results, and a normal match all included it), so if a future
   * response is ever missing it, that's treated as "can't verify" and
   * rejected rather than silently skipping the check.
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
    signal?: AbortSignal,
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
          { abortSignal: signal },
        ),
      );

      if (pageCount === 0) {
        if (response.distanceMetric === undefined) {
          throw new S3VectorsError(
            `QueryVectors response for index "${this.indexName}" did not include a distanceMetric — ` +
              `cannot verify it matches this store's configured "${this.distanceMetric}". Relevance ` +
              `scores would be computed against an unverified metric.`,
            S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
            { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
          );
        }
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
   * Run a per-batch write `action` across pre-chunked batches. The FIRST
   * batch is always awaited alone — it's the one that creates or validates
   * the index (`batchOffset === 0` inside {@link _ensureIndexAndPut}), so
   * every later batch's write depends on it having already happened. Every
   * batch after that is independent and is dispatched concurrently, in
   * groups of at most {@link MAX_CONCURRENT_BATCH_CALLS} in flight at once
   * — the same concurrency pattern {@link delete} and {@link getByIds}
   * already use for `DeleteVectors`/`GetVectors`.
   *
   * Waits out every sibling in a group via `Promise.allSettled` rather than
   * racing ahead on the first rejection — a slower sibling that succeeds
   * *after* another one fails would otherwise be lost from the failed
   * write's reported `writtenIds`. On any failure, the thrown error carries
   * every id confirmed written so far (from this batch's earlier groups and
   * from any group siblings that succeeded alongside the one that failed).
   *
   * @internal Used by `addVectors`. `addDocuments` needs its embedding
   * step to stay strictly sequential across batches (unlike this helper's
   * concurrent dispatch), so it doesn't route through here — see its own
   * batching loop.
   */
  private async _runBatchesConcurrently<T>(
    operation: string,
    batches: T[][],
    ids: string[],
    action: (batch: T[], offset: number) => Promise<void>,
  ): Promise<void> {
    // addVectors (this helper's only caller) returns early on an empty
    // vectors array before ever reaching here, so batches is never empty.
    const firstBatch = batches[0]!;
    let writtenIds: string[] = [];
    try {
      await action(firstBatch, 0);
      writtenIds = ids.slice(0, firstBatch.length);
    } catch (error: unknown) {
      throw this._attachPartialIds(error, operation, 'writtenIds', writtenIds);
    }

    const rest: { batch: T[]; offset: number }[] = [];
    let offset = firstBatch.length;
    for (const batch of batches.slice(1)) {
      rest.push({ batch, offset });
      offset += batch.length;
    }

    for (const group of chunk(rest, MAX_CONCURRENT_BATCH_CALLS)) {
      const results = await Promise.allSettled(
        group.map(({ batch, offset: batchOffset }) =>
          action(batch, batchOffset).then(() => ({ offset: batchOffset, length: batch.length })),
        ),
      );
      let firstError: unknown = null;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          writtenIds.push(
            ...ids.slice(result.value.offset, result.value.offset + result.value.length),
          );
        } else if (firstError === null) {
          firstError = result.reason;
        }
      }
      if (firstError !== null) {
        throw this._attachPartialIds(firstError, operation, 'writtenIds', writtenIds);
      }
    }
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
    signal?: AbortSignal,
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

      // Every vector in this batch must share the first vector's dimension
      // — that's the dimension this batch is validated against (or, for a
      // brand-new index, created with) just below. Without this, only
      // vectors[0] was ever checked locally.
      for (let i = 1; i < vectors.length; i++) {
        const vector = vectors[i]!;
        if (vector.length !== firstVector.length) {
          throw new S3VectorsError(
            `Vector at index ${i} in this batch has dimension ${vector.length}, but this ` +
              `batch's first vector has dimension ${firstVector.length}. All vectors in the ` +
              'same batch must share the same dimension.',
            S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
            { operation, vectorBucketName: this.vectorBucketName, indexName: this.indexName },
          );
        }
      }

      await this._validateBeforeWrite(firstVector, operation, signal);
    }

    await this._send('PutVectors', () =>
      this._client.send(
        new PutVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          vectors: putVectors,
        }),
        { abortSignal: signal },
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
   * {@link _validatedIndexInfo} is checked first regardless of
   * {@link createIndexIfNotExist} — once any write has confirmed the
   * index's dimension/metric (whether by finding it already there,
   * creating it, or recovering from a cross-process creation race), every
   * later write on this instance reuses that cached value instead of
   * re-fetching. Only the very first write (or the first write after
   * {@link delete}'s `deleteAll` clears the cache) pays for a `GetIndex`
   * (or `GetIndex`+`CreateIndex`) round trip; every one after that is a
   * single `PutVectors` call, for both `createIndexIfNotExist: true` and
   * `false`. When `createIndexIfNotExist` is `false` and the index
   * genuinely doesn't exist yet, this deliberately does *not* throw —
   * `PutVectors` still fails naturally below, matching this flag's
   * pre-existing behavior for a missing index (it never auto-creates one).
   */
  private async _validateBeforeWrite(
    firstVector: number[],
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (this._validatedIndexInfo !== null) {
      this._assertIndexCompatible(this._validatedIndexInfo, firstVector, operation);
      return;
    }

    if (this.createIndexIfNotExist) {
      // _raceAbort takes a thunk (not an already-started promise)
      // specifically so its own abort check runs before _ensureIndexExists
      // is ever called — see _raceAbort's remarks for why that ordering
      // matters.
      const { existing, epoch } = await this._raceAbort(
        () => this._ensureIndexExists(firstVector),
        signal,
        operation,
      );
      if (existing !== null) {
        if (this._indexEpoch === epoch) {
          this._validatedIndexInfo = existing;
        }
        // A caller that joins this memo while it spans a concurrent
        // `deleteAll` still validates `firstVector` against the pre-delete
        // `existing` it returned — the epoch guard above only stops that
        // stale info from being cached, not from being used for this one
        // write's own validation. Its `PutVectors` call then fails
        // naturally against the now-deleted index, same as any other
        // write racing a `deleteAll` it didn't itself trigger.
        this._assertIndexCompatible(existing, firstVector, operation);
      }
      return;
    }

    const epoch = this._indexEpoch;
    const existing = await this._getIndex(signal);
    if (existing !== null) {
      if (this._indexEpoch === epoch) {
        this._validatedIndexInfo = existing;
      }
      this._assertIndexCompatible(existing, firstVector, operation);
    }
  }

  /**
   * Ensure the configured index exists, creating it if needed, and return
   * its dimension/distance metric plus the epoch (see {@link _indexEpoch})
   * it was computed under — from the pre-existing index, from the index
   * this call just created, or (after losing a cross-process creation
   * race) re-fetched so the winning process's actual committed
   * dimension/metric is still known. `existing` is only `null` if that
   * post-race re-fetch itself finds nothing (the index was deleted again
   * in the brief window since the conflict).
   *
   * In-flight creation attempts are memoized so concurrent callers share
   * one GetIndex/CreateIndex sequence instead of racing (same-process
   * safety); a `ConflictException` from CreateIndex itself (another
   * process won the race) is tolerated as success (cross-process safety).
   * The memo is cleared once the attempt settles, so a later top-level
   * call still re-verifies existence.
   *
   * @remarks
   * This memo's `GetIndex`/`CreateIndex` calls are never tied to any
   * caller's `AbortSignal` — a caller can only make its own wait for this
   * memo return early (via {@link _raceAbort}), never cancel the shared
   * work other concurrent callers depend on. Only the existence-check/
   * creation is memoized — never compatibility validation itself; callers
   * must run {@link _assertIndexCompatible} themselves against the
   * returned value and their own vector. `firstVector` is only actually
   * used by whichever caller's invocation wins the race to start this
   * memo; later concurrent callers get the already-in-flight promise back
   * before their own arguments are ever consulted. Callers must validate
   * their own vector is non-empty *before* calling this.
   */
  private _ensureIndexExists(firstVector: number[]): Promise<{
    existing: { dimension: number; distanceMetric: DistanceMetric } | null;
    epoch: number;
  }> {
    if (this._ensureIndexPromise) return this._ensureIndexPromise;

    const epoch = this._indexEpoch;
    this._ensureIndexPromise = (async () => {
      try {
        const existing = await this._getIndex();
        if (existing !== null) {
          return { existing, epoch };
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
          return { existing: await this._getIndex(), epoch };
        }
        return {
          existing: { dimension: firstVector.length, distanceMetric: this.distanceMetric },
          epoch,
        };
      } finally {
        this._ensureIndexPromise = null;
      }
    })();

    return this._ensureIndexPromise;
  }

  /**
   * Let `signal` make the caller's own wait for `factory()`'s promise
   * reject early — with the same coded `ABORTED` error {@link _checkAborted}
   * throws elsewhere — without cancelling that promise itself. Used so one
   * caller's `AbortSignal` can never cancel, or get blamed for, a sibling
   * caller's dependency on {@link _ensureIndexExists}'s shared
   * GetIndex/CreateIndex memo.
   *
   * @remarks
   * Takes a factory rather than an already-started promise so the check
   * below runs *before* `factory()` is ever called: a plain promise
   * argument is evaluated before this function's own body starts, which
   * would let an already-aborted signal still create/join a shared memo
   * and dispatch a real AWS call before anything had a chance to reject.
   */
  private _raceAbort<T>(
    factory: () => Promise<T>,
    signal: AbortSignal | undefined,
    operation: string,
  ): Promise<T> {
    if (!signal) return factory();
    this._checkAborted(operation, signal);

    const promise = factory();
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        try {
          this._checkAborted(operation, signal);
        } catch (error: unknown) {
          reject(toError(error));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(toError(error));
        },
      );
    });
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
  private async _getIndex(
    signal?: AbortSignal,
  ): Promise<{ dimension: number; distanceMetric: DistanceMetric } | null> {
    try {
      const result = await this._client.send(
        new GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
        { abortSignal: signal },
      );
      const { index } = result;
      if (
        index === undefined ||
        typeof index.dimension !== 'number' ||
        (index.distanceMetric !== 'cosine' && index.distanceMetric !== 'euclidean')
      ) {
        throw new S3VectorsError(
          `GetIndex for "${this.indexName}" resolved without the expected index attributes ` +
            '(dimension/distanceMetric). The response may be malformed, or come from an ' +
            'incompatible SDK version or a mocked/stubbed client.',
          S3VectorsErrorCode.AWS_INVALID_RESPONSE,
          {
            operation: 'GetIndex',
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
          },
        );
      }
      return { dimension: index.dimension, distanceMetric: index.distanceMetric };
    } catch (error: unknown) {
      if (isAwsNotFoundException(error)) return null;
      const code = isAbortError(error)
        ? S3VectorsErrorCode.ABORTED
        : S3VectorsErrorCode.AWS_REQUEST_FAILED;
      throw wrapAwsError(error, code, {
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
   * count as *filterable* metadata, capped at 2048 bytes per vector by AWS —
   * and S3 Vectors has no `UpdateIndex`, so a document over that size
   * would only fail at write time, against an index that can never be
   * fixed without deleting it (and every vector already in it).
   */
  private async _createIndex(dimension: number, signal?: AbortSignal): Promise<void> {
    const MAX_NON_FILTERABLE_KEYS = 10;
    const configuredKeys = this.nonFilterableMetadataKeys ?? [];
    const withPageContentKey =
      this.pageContentMetadataKey === null
        ? this.nonFilterableMetadataKeys
        : [...new Set([...configuredKeys, this.pageContentMetadataKey])];

    // Scoped to "adding the page-content key specifically is what pushes
    // this over the cap" — a caller-configured list that already exceeds
    // the cap on its own (pageContentMetadataKey: null, or the key already
    // present in the caller's list, included) is a different, pre-existing
    // user error that AWS's own CreateIndex validation already rejects
    // clearly; this message would be misleading for that case since no
    // page-content key is being added.
    if (
      this.pageContentMetadataKey !== null &&
      !configuredKeys.includes(this.pageContentMetadataKey) &&
      withPageContentKey &&
      withPageContentKey.length > MAX_NON_FILTERABLE_KEYS
    ) {
      throw this._validationError(
        'createIndex',
        `Cannot add pageContentMetadataKey ("${this.pageContentMetadataKey}") to ` +
          `nonFilterableMetadataKeys — that would exceed AWS's ${MAX_NON_FILTERABLE_KEYS}-key ` +
          `cap (currently ${configuredKeys.length} configured). Reduce ` +
          `nonFilterableMetadataKeys, or set pageContentMetadataKey: null to store page content ` +
          `as filterable metadata instead (capped at 2048 bytes per vector by AWS).`,
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
        { abortSignal: signal },
      ),
    );
  }
}
