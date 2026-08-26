import { S3VectorsErrorCode } from './error-code.js';

/** Structured context attached to every {@link S3VectorsError}. */
export interface S3VectorsErrorContext {
  /** The logical operation that failed (e.g. `"PutVectors"`, `"getByIds"`). */
  readonly operation: string;
  readonly vectorBucketName?: string;
  readonly indexName?: string;
  /**
   * Ids confirmed durably written to AWS before a partial `addVectors`/
   * `addDocuments` failure — present so a caller (especially one relying
   * on auto-generated ids, which are otherwise lost entirely on failure)
   * can find and clean up or reconcile vectors that already landed.
   */
  readonly writtenIds?: string[];
  /** Ids confirmed durably deleted before a partial `delete({ ids })` failure. */
  readonly deletedIds?: string[];
}

const S3_VECTORS_ERROR_BRAND = Symbol.for('@farukada/aws-langchain-s3-vector-ts:S3VectorsError');

/**
 * The single error type surfaced by this library. Wraps validation failures,
 * not-found conditions, and underlying AWS errors behind one consistent shape.
 */
export class S3VectorsError extends Error {
  readonly [S3_VECTORS_ERROR_BRAND] = true;
  readonly code: S3VectorsErrorCode;
  readonly context: S3VectorsErrorContext;

  constructor(
    message: string,
    code: S3VectorsErrorCode,
    context: S3VectorsErrorContext,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'S3VectorsError';
    this.code = code;
    this.context = context;
  }
}

/** Type guard for {@link S3VectorsError} that avoids `instanceof`. */
export function isS3VectorsError(value: unknown): value is S3VectorsError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, boolean>)[S3_VECTORS_ERROR_BRAND] === true
  );
}
