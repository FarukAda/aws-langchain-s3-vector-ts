import { MAX_DIMENSION, MIN_DIMENSION } from '../shared/aws-limits.js';
import { describeRecord, type RecordRef, renderValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { OperationScope } from '../shared/scope.js';
import type { DistanceMetric } from '../types.js';

/**
 * Why S3 Vectors cannot store, or search with, this vector — or `undefined` if
 * it can.
 *
 * Accepts: anything, and the metric of the index it is for.
 *
 * Returns: a clause written to follow a subject ("Vector at index 4 …"), for the
 * first rule broken, in this order:
 * - not an array;
 * - a dimension outside 1–4096 (limits page, `s3-vectors-limitations.html`);
 * - a component that is not a finite number: "Invalid values such as NaN (Not a
 *   Number) or Infinity aren't allowed"
 *   (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutInputVector.html).
 *   A hole reads as `undefined`, so it is caught here too;
 * - zero norm, on a `cosine` index only: "cosine distance does not support
 *   vectors with zero norm" (docs/evidence/zero-vector.md). That evidence names
 *   cosine, so a `euclidean` index is not checked.
 *
 * Throws: nothing.
 */
export function vectorRejectionReason(
  vector: unknown,
  distanceMetric: DistanceMetric,
): string | undefined {
  if (!Array.isArray(vector)) return `is not an array (received ${renderValue(vector)})`;
  if (vector.length < MIN_DIMENSION || vector.length > MAX_DIMENSION) {
    return (
      `has dimension ${vector.length}, but a vector must have between ${MIN_DIMENSION} and ` +
      `${MAX_DIMENSION} components`
    );
  }
  let sumOfSquares = 0;
  for (let position = 0; position < vector.length; position++) {
    const component: unknown = vector[position];
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      return (
        `has a component at position ${position} that is not a finite number (received ` +
        `${renderValue(component)}). S3 Vectors rejects NaN and Infinity`
      );
    }
    sumOfSquares += component * component;
  }
  if (distanceMetric === 'cosine' && sumOfSquares === 0) {
    return (
      'has zero norm, which a cosine index rejects. An embeddings model handed an empty ' +
      'string, or a normalisation dividing by a zero norm, produces this'
    );
  }
  return undefined;
}

/** Options for {@link assertWriteVectors}. */
export interface WriteVectorOptions extends OperationScope {
  /** The metric of the index being written to. */
  readonly distanceMetric: DistanceMetric;
  /** Where these vectors start in the caller's input. */
  readonly offset: number;
  /** The id of each vector, in the same order. */
  readonly ids: readonly string[];
}

/**
 * Reject vectors about to be written.
 *
 * Accepts: vectors and their ids, in the same order, and `offset` — their
 * position in the caller's input.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError}, carrying `recordIndex` (`offset` plus the
 * position here) and `recordId`:
 * - `VALIDATION` for the first vector {@link vectorRejectionReason} refuses;
 * - `INDEX_CONFIG_MISMATCH` for the first vector whose dimension differs from
 *   the first vector's. An index has one dimension (userguide
 *   `s3-vectors-indexes.html`), so vectors that disagree can never all be
 *   written, and the caller's real question is which index they meant.
 *
 * Guarantees: every vector is checked, in order, and checked for what is broken
 * before its dimension is compared — so a `null` anywhere is `VALIDATION`, never
 * a `TypeError` on the vector after it.
 */
export function assertWriteVectors(vectors: readonly unknown[], opts: WriteVectorOptions): void {
  const { distanceMetric, offset, ids, ...scope } = opts;
  const fail = (position: number, message: string, code: S3VectorsErrorCode): never => {
    const record: RecordRef = { recordIndex: offset + position, recordId: ids[position]! };
    throw new S3VectorsError(`${describeRecord('Vector', record)} ${message}.`, code, {
      ...scope,
      ...record,
    });
  };
  for (let position = 0; position < vectors.length; position++) {
    const reason = vectorRejectionReason(vectors[position], distanceMetric);
    if (reason !== undefined) fail(position, reason, S3VectorsErrorCode.VALIDATION);
    const dimension = (vectors[position] as unknown[]).length;
    const expected = (vectors[0] as unknown[]).length;
    if (dimension !== expected) {
      fail(
        position,
        `has dimension ${dimension}, but the vector at index ${offset} has dimension ` +
          `${expected}. Every vector written to one index must share its dimension`,
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
      );
    }
  }
}

/** Options for {@link assertQueryVector}. */
export interface QueryVectorOptions extends OperationScope {
  /** The metric of the index being searched. */
  readonly distanceMetric: DistanceMetric;
}

/**
 * Reject a query vector.
 *
 * Accepts: anything, as the embedding to search with.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} `VALIDATION`, as "Query vector …", for any rule
 * {@link vectorRejectionReason} states. It carries no record fields, because a
 * query is not an element of a list.
 *
 * Guarantees: these are the rules a stored vector is held to, and AWS applies
 * them to a query too — answering every one with "Query vector contains invalid
 * values or is invalid for this index", which names neither the component nor
 * the reason.
 */
export function assertQueryVector(vector: unknown, opts: QueryVectorOptions): void {
  const { distanceMetric, ...scope } = opts;
  const reason = vectorRejectionReason(vector, distanceMetric);
  if (reason !== undefined) {
    throw new S3VectorsError(`Query vector ${reason}.`, S3VectorsErrorCode.VALIDATION, scope);
  }
}
