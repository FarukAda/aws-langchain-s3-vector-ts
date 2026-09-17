import type {
  EncryptionConfiguration,
  S3VectorsClient,
  S3VectorsClientConfig,
} from '@aws-sdk/client-s3vectors';
import type { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Distance metrics supported by Amazon S3 Vectors indexes. */
export type DistanceMetric = 'euclidean' | 'cosine';

/** Data types supported by Amazon S3 Vectors. Currently only float32. */
export type VectorDataType = 'float32';

/**
 * Configuration options for the {@link AmazonS3Vectors} vector store.
 *
 * `vectorBucketName` and `indexName` are required; everything else has a
 * default or is optional. `embeddings` and `client` are not alternatives to
 * one another: `embeddings` decides whether the text-taking methods work at
 * all (without it they raise `EMBEDDINGS_MISSING`, while the vector-taking
 * ones are unaffected), and `client` decides whether this store builds its own
 * SDK client or uses yours.
 */
export interface AmazonS3VectorsConfig {
  // ── Index / bucket ──────────────────────────────────────────────────────

  /** Name of an existing S3 vector bucket. Must be created manually beforehand. */
  readonly vectorBucketName: string;

  /**
   * Name of the vector index inside the bucket.
   * Must be 3–63 characters, start and end with a letter or number,
   * and contain only lowercase letters, numbers, hyphens, and dots.
   */
  readonly indexName: string;

  /**
   * Data type for the vectors stored in the index.
   * @defaultValue `"float32"`
   */
  readonly dataType?: VectorDataType;

  /**
   * Distance metric used for similarity search.
   * @defaultValue `"cosine"`
   */
  readonly distanceMetric?: DistanceMetric;

  /**
   * Metadata keys that should **not** be filterable in queries.
   * All other metadata keys are filterable by default.
   */
  readonly nonFilterableMetadataKeys?: string[];

  /**
   * Metadata key under which to store the document `page_content`.
   *
   * - When set (default `"_page_content"`), the text is stored alongside
   *   user-provided metadata and restored when reading documents back.
   * - When `null`, page content is embedded but **not stored at all**: no key
   *   is written for it, and a document read back has an empty `pageContent`.
   *   Useful when you want to minimise metadata size, and the only way to keep
   *   page content out of the 40 KB per-vector budget entirely.
   *
   * @defaultValue `"_page_content"`
   */
  readonly pageContentMetadataKey?: string | null;

  /**
   * When `true`, the index is created automatically if it does not exist
   * on the first `addVectors` / `addDocuments` call: that write issues one
   * `GetIndex` and, when the index is missing, one `CreateIndex`.
   *
   * When `false`, neither call is made. Nothing is checked there that AWS
   * does not already enforce on the write itself, so a store that never
   * creates an index needs no control-plane permission at all — a missing
   * index simply fails at `PutVectors`.
   * @defaultValue `true`
   */
  readonly createIndexIfNotExist?: boolean;

  /**
   * Server-side encryption to request for an index this store creates
   * (`createIndexIfNotExist: true`). Forwarded verbatim to `CreateIndex`;
   * accepts the SDK's own shape, e.g. `{ sseType: 'aws:kms', kmsKeyArn: '…' }`.
   * Ignored for an index that already exists — S3 Vectors has no
   * `UpdateIndex`, so encryption is fixed at creation.
   *
   * When omitted, AWS applies the vector bucket's default encryption
   * (`AES256` unless the bucket was configured otherwise). Set this if
   * your organisation requires a customer-managed KMS key on every index,
   * or pre-create the index with your own tooling and use
   * `createIndexIfNotExist: false`.
   */
  readonly encryptionConfiguration?: EncryptionConfiguration;

  /**
   * Tags to apply to an index this store creates (`createIndexIfNotExist:
   * true`), for cost allocation or attribute-based access control.
   * Forwarded verbatim to `CreateIndex` (`Record<string, string>`, up to
   * AWS's 50-tag limit). Ignored for an index that already exists.
   */
  readonly tags?: Record<string, string>;

  /**
   * Maximum number of `PutVectors` / `DeleteVectors` / `GetVectors`
   * calls this store keeps in flight at once during a batched
   * `addDocuments`, `addVectors`, `delete({ ids })` or `getByIds`.
   *
   * Raise it to ingest faster against a generous account-level rate
   * limit; lower it (down to `1` for strictly sequential calls) if you
   * share the account's S3 Vectors request quota with other workloads or
   * see sustained `TooManyRequestsException`s even with the SDK's own retries.
   * Peak memory for in-flight write payloads scales with
   * `maxConcurrentBatchCalls × batchSize`.
   * @defaultValue `10`
   */
  readonly maxConcurrentBatchCalls?: number;

  /**
   * Converts a raw distance into a relevance score, for
   * `similaritySearchWithRelevanceScores` and the retriever's score
   * threshold. Nothing else uses it: `similaritySearchWithScore` returns the
   * service's distance untouched.
   *
   * Omitting it is only safe on a cosine index, where the built-in
   * `cosineRelevanceScoreFn` is the exact inverse of what the service
   * returns. A **euclidean** index has no built-in: euclidean distance is
   * unbounded above, so no fixed formula maps it to a comparable score
   * without knowing the embedding's scale, which only you know. Asking for
   * relevance scores on a euclidean index without this option raises
   * `VALIDATION` rather than returning numbers comparable against nothing.
   */
  readonly relevanceScoreFn?: (distance: number) => number;

  // ── Embeddings ──────────────────────────────────────────────────────────

  /**
   * Embedding model used for both indexing and querying.
   * Required unless you only call methods that accept raw vectors.
   */
  readonly embeddings?: EmbeddingsInterface;

  /**
   * Separate embedding model used exclusively for queries.
   * Useful when the embedding provider differentiates between
   * document-embedding and query-embedding tasks.
   *
   * Falls back to {@link embeddings} when not set.
   */
  readonly queryEmbeddings?: EmbeddingsInterface;

  // ── AWS client ──────────────────────────────────────────────────────────

  /**
   * A pre-configured `S3VectorsClient` instance.
   *
   * Exclusive with every option that would configure one: supplying it
   * together with `region`, `credentials`, `endpoint`, `maxAttempts`,
   * `retryMode`, `connectionTimeout`, `socketTimeout` or `requestTimeout` is
   * rejected with `VALIDATION` rather than silently resolved in the client's
   * favour.
   */
  readonly client?: S3VectorsClient;

  /**
   * AWS region to use when creating the SDK client (e.g. `"us-east-1"`).
   * Not accepted together with `client`.
   */
  readonly region?: string;

  /**
   * AWS credentials: either a static credential object or an async
   * provider function — the same shape `S3VectorsClient` itself accepts.
   * Not accepted together with `client`.
   */
  readonly credentials?: S3VectorsClientConfig['credentials'];

  /**
   * Custom endpoint URL to use instead of the default regional endpoint.
   * Not accepted together with `client`.
   */
  readonly endpoint?: string;

  /**
   * Maximum number of attempts (initial try + retries) for AWS requests.
   * Forwarded to the AWS SDK retry strategy. Not accepted together with
   * `client`, which carries its own.
   */
  readonly maxAttempts?: number;

  /**
   * AWS SDK retry mode. Throttling (`TooManyRequestsException`), 5xx errors and
   * the SDK's own `TimeoutError` are retried by the SDK. Not accepted together
   * with `client`, which carries its own.
   */
  readonly retryMode?: 'standard' | 'adaptive' | 'legacy';

  /**
   * Milliseconds the connection phase of a request may take before it is
   * abandoned, defaulting to 5,000. `0` disables it. Not accepted together
   * with `client`, which carries its own request handler.
   *
   * A `TimeoutError` from this is `SERVICE_UNAVAILABLE` and retryable.
   */
  readonly connectionTimeout?: number;

  /**
   * Milliseconds a socket may sit **idle** before the request is failed,
   * defaulting to 60,000. `0` disables it. Not accepted together with
   * `client`.
   *
   * This is the timeout that ends a request to an endpoint which accepts the
   * connection and then never answers. It is idle-based, so it does not
   * interrupt a large upload that is still making progress — which is why it,
   * rather than {@link requestTimeout}, is the one with a default.
   *
   * A `TimeoutError` from this is `SERVICE_UNAVAILABLE` and retryable, so the
   * worst-case wait for a black-holed endpoint is `maxAttempts` times this
   * value, plus backoff.
   */
  readonly socketTimeout?: number;

  /**
   * Milliseconds a whole request and response may take, as a **total
   * deadline**. No default, and `0` disables it. Not accepted together with
   * `client`.
   *
   * Deliberately not defaulted: a 500-vector batch at 4,096 dimensions is a
   * large upload, and a deadline would end it however healthy the transfer is.
   * Set it only when a hard ceiling is what you want.
   *
   * Setting it also sets the SDK's `throwOnRequestTimeout`. Without that flag
   * the SDK emits a warning and keeps waiting, so the option would otherwise
   * mean something other than what its name says.
   *
   * A `TimeoutError` from this is `SERVICE_UNAVAILABLE` and retryable. The
   * deadline applies to each attempt, so a call can take up to `maxAttempts`
   * times this value, plus backoff.
   */
  readonly requestTimeout?: number;
}

// ─── Output / parameter types ────────────────────────────────────────────────

/**
 * Shape of a single vector as returned by QueryVectors / GetVectors.
 *
 * Public because it is the shape the store reads: a caller mapping their own
 * `QueryVectors` or `GetVectors` responses (for example from a Lambda that
 * calls the SDK directly) can type them against the same contract this store
 * maps to `Document`.
 */
export interface S3OutputVector {
  /** The vector key — the id this package wrote it under. */
  readonly key: string;
  /**
   * The stored metadata, present when the request asked for it. Page content
   * is in here, under the store's `pageContentMetadataKey`, until
   * `createDocument` lifts it out.
   */
  readonly metadata?: Record<string, unknown>;
  /**
   * The distance from the query vector, present only on a `QueryVectors`
   * result that asked for it. Lower is more similar, for both metrics.
   */
  readonly distance?: number;
  /**
   * The embedding, present only when the request asked for data. Absent from
   * every search result: `QueryVectors` does not return vector data at all,
   * which is why MMR needs a second call.
   */
  readonly data?: { float32?: number[] };
}

/** Options accepted by {@link AmazonS3Vectors.delete}. */
export interface S3VectorsDeleteParams {
  /**
   * The vector ids to delete. Required: `delete` removes vectors, and nothing
   * else. Destroying the index is {@link AmazonS3Vectors.deleteIndex}, which
   * has to be named to be called.
   */
  readonly ids: string[];
  /**
   * Batch size for `DeleteVectors` calls.
   * @defaultValue `500`
   */
  readonly batchSize?: number;
  /**
   * Abort an in-progress delete. Cancels the `DeleteVectors` call currently in
   * flight and stops any further batches from starting.
   */
  readonly signal?: AbortSignal;
}

/** Options accepted by {@link AmazonS3Vectors.deleteIndex}. */
export interface S3VectorsDeleteIndexParams {
  /**
   * Abort the deletion. An already-fired signal rejects before any request;
   * one that fires while an index creation is being awaited ends this
   * caller's wait without cancelling that shared work.
   */
  readonly signal?: AbortSignal;
}

/**
 * Options accepted by {@link AmazonS3Vectors.listDocuments} and
 * {@link AmazonS3Vectors.listVectors}.
 *
 * There is no `filter`: `ListVectors` accepts none, and emulating one by
 * enumerating and discarding would bill for every vector in the index while
 * looking like a server-side filter.
 */
export interface S3VectorsListParams {
  /**
   * Vectors requested per `ListVectors` call: an integer 1-1000. Advisory —
   * AWS stops a page at 1 MB of processed data regardless, so a short page is
   * normal and only an absent `nextToken` ends the listing.
   * @defaultValue the service default of 500
   */
  readonly pageSize?: number;
  /**
   * Abort an in-progress listing. Checked before each page and threaded into
   * the request, so it both cancels the page in flight and stops the next one
   * from being requested.
   */
  readonly signal?: AbortSignal;
}

/**
 * One record yielded by {@link AmazonS3Vectors.listVectors}: everything needed
 * to write the same vector into a different index.
 */
export interface S3VectorsRecord {
  /** The vector key, the same value {@link AmazonS3Vectors.getByIds} takes. */
  readonly id: string;
  /** The stored embedding, ready to hand back to `addVectors`. */
  readonly vector: number[];
  /** The document, mapped exactly as the search paths and `getByIds` map it. */
  readonly document: Document;
}
