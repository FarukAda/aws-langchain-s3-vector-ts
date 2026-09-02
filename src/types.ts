import type {
  EncryptionConfiguration,
  S3VectorsClient,
  S3VectorsClientConfig,
} from '@aws-sdk/client-s3vectors';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Distance metrics supported by Amazon S3 Vectors indexes. */
export type DistanceMetric = 'euclidean' | 'cosine';

/** Data types supported by Amazon S3 Vectors. Currently only float32. */
export type VectorDataType = 'float32';

/**
 * Configuration options for the {@link AmazonS3Vectors} vector store.
 *
 * At minimum, `vectorBucketName` and `indexName` are required.
 * Either `embeddings` or `client` (or both) should be provided depending
 * on the intended usage pattern.
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
   * - When `null`, page content is embedded but stored as an empty string
   *   (useful when you want to minimise metadata size).
   *
   * @defaultValue `"_page_content"`
   */
  readonly pageContentMetadataKey?: string | null;

  /**
   * When `true`, the index is created automatically if it does not exist
   * on the first `addVectors` / `addDocuments` call.
   *
   * Note that `false` does **not** remove the need for `s3vectors:GetIndex`
   * permission: every first write on an instance calls `GetIndex` once to
   * validate the index's dimension and distance metric against this
   * store's configuration, regardless of this flag. The flag only controls
   * whether a *missing* index is created (`CreateIndex`) or left to fail
   * at `PutVectors`.
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
   * see sustained `ThrottlingException`s even with the SDK's own retries.
   * Peak memory for in-flight write payloads scales with
   * `maxConcurrentBatchCalls × batchSize`.
   * @defaultValue `10`
   */
  readonly maxConcurrentBatchCalls?: number;

  /**
   * Optional custom function that converts a raw distance value into a
   * relevance score. If not provided, a built-in function is selected
   * based on the configured {@link distanceMetric}.
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
   * When provided, `region`, `credentials`, and `endpoint` are ignored.
   */
  readonly client?: S3VectorsClient;

  /** AWS region to use when creating the SDK client (e.g. `"us-east-1"`). */
  readonly region?: string;

  /**
   * AWS credentials: either a static credential object or an async
   * provider function — the same shape `S3VectorsClient` itself accepts.
   */
  readonly credentials?: S3VectorsClientConfig['credentials'];

  /** Custom endpoint URL to use instead of the default regional endpoint. */
  readonly endpoint?: string;

  /**
   * Maximum number of attempts (initial try + retries) for AWS requests.
   * Forwarded to the AWS SDK retry strategy. Ignored when `client` is provided.
   */
  readonly maxAttempts?: number;

  /**
   * AWS SDK retry mode. Throttling and 5xx errors are retried by the SDK.
   * Ignored when `client` is provided.
   */
  readonly retryMode?: 'standard' | 'adaptive' | 'legacy';
}

// ─── Output / parameter types ────────────────────────────────────────────────

/**
 * Shape of a single vector as returned by QueryVectors / GetVectors.
 *
 * Public: this is the input type of the exported `createDocument` helper,
 * so a caller mapping their own `QueryVectors` responses (for example from
 * a Lambda that calls the SDK directly) can build the same `Document`
 * shape this store produces.
 */
export interface S3OutputVector {
  readonly key: string;
  readonly metadata?: Record<string, unknown>;
  readonly distance?: number;
  readonly data?: { float32?: number[] };
}

/** Options accepted by {@link AmazonS3Vectors.delete}. */
export interface S3VectorsDeleteParams {
  /** Vector IDs to delete. Omit together with {@link deleteAll} to delete the entire index. */
  readonly ids?: string[];
  /**
   * Batch size for `DeleteVectors` calls.
   * @defaultValue `500`
   */
  readonly batchSize?: number;
  /**
   * Must be explicitly `true` to delete the **entire index** (used together
   * with omitting `ids`). Guards against an accidentally-`undefined` `ids`
   * array silently wiping the whole index.
   */
  readonly deleteAll?: true;
  /**
   * Abort an in-progress delete. Cancels the `DeleteVectors`/`DeleteIndex`
   * call currently in flight and stops any further batches from starting.
   */
  readonly signal?: AbortSignal;
}
