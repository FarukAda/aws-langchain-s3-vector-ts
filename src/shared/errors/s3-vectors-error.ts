import type { AmazonS3Vectors } from '../../s3-vectors.js';
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
  /**
   * `QueryVectors` pages scanned before this library's page limit stopped
   * the search. Only set on a `QUERY_PAGE_LIMIT_EXCEEDED` error.
   */
  readonly pagesScanned?: number;
  /**
   * Results collected before this library's page limit stopped the search.
   * Only set on a `QUERY_PAGE_LIMIT_EXCEEDED` error — compare against the
   * requested `k` to see how far short the search fell.
   */
  readonly resultsCollected?: number;
  /**
   * Ids confirmed found (and already fetched) before a partial `getByIds`
   * failure — either a `GetVectors` batch rejecting while sibling batches
   * in the same concurrency group succeed, or an id genuinely not found
   * after other ids in the same group were already confirmed. Present so
   * a caller doesn't have to re-fetch everything from scratch.
   */
  readonly foundIds?: string[];
  /**
   * The store constructed by a `fromDocuments`/`fromTexts` factory call that
   * failed partway through writing. Only ever set on an error thrown by
   * those two static factories — every other operation already runs
   * against a `this` the caller already holds a reference to. Lets a
   * caller act on `writtenIds` (`.delete({ ids: writtenIds })`,
   * `.getByIds(writtenIds)`) against the exact instance the ids were
   * written to, instead of reconstructing an equivalent one by hand.
   *
   * Unlike every other field here, this is a live object handle, not
   * plain diagnostic data — treat it as a reference for programmatic
   * recovery (`error.context.instance.delete({ ids: writtenIds })`), not
   * as something to log. It does `JSON.stringify` safely: `AmazonS3Vectors`
   * pins `lc_serializable = false`, so LangChain's `Serializable#toJSON()`
   * short-circuits to a small type-identifier stub rather than dumping
   * internal state, and a regression test asserts no `_client` or
   * credentials appear in the output. That stub is rarely useful in a log
   * line, so prefer logging the other context fields individually.
   */
  readonly instance?: AmazonS3Vectors;
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
