import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';
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
   * @defaultValue `true`
   */
  readonly createIndexIfNotExist?: boolean;

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
   * AWS credentials configuration. Accepts any shape compatible with
   * the AWS SDK credential provider chain.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AWS credential types are complex and vary by SDK version
  readonly credentials?: any;

  /** Custom endpoint URL to use instead of the default regional endpoint. */
  readonly endpoint?: string;
}

// ─── Internal types ──────────────────────────────────────────────────────────

/** Shape of a single vector as returned by QueryVectors / GetVectors. */
export interface S3OutputVector {
  readonly key: string;
  readonly metadata?: Record<string, unknown>;
  readonly distance?: number;
  readonly data?: { float32?: number[] };
}

/** Options accepted by {@link AmazonS3Vectors.delete}. */
export interface S3VectorsDeleteParams {
  /** Vector IDs to delete. When `undefined`, the entire index is deleted. */
  readonly ids?: string[];
  /**
   * Batch size for `DeleteVectors` calls.
   * @defaultValue `500`
   */
  readonly batchSize?: number;
}
