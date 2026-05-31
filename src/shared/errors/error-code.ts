/** Stable error codes surfaced by {@link S3VectorsError}. */
export enum S3VectorsErrorCode {
  /** Caller-supplied arguments were invalid (counts, names, empty batch). */
  VALIDATION = 'VALIDATION',
  /** A requested vector id or index was not found. */
  NOT_FOUND = 'NOT_FOUND',
  /** An operation needed an embedding model but none was configured. */
  EMBEDDINGS_MISSING = 'EMBEDDINGS_MISSING',
  /** An underlying AWS S3 Vectors request failed. */
  AWS_REQUEST_FAILED = 'AWS_REQUEST_FAILED',
}
