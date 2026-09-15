import { renderValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { DistanceMetric } from '../types.js';
import type { StoreScope } from './signals.js';

/** Documented at https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html */
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;

/** Raise a `VALIDATION` naming the operation and index. */
function fail(message: string, operation: string, scope: StoreScope): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation, ...scope });
}

/**
 * Reject a vector dimension AWS would refuse.
 *
 * Accepts: `dimension` — an integer 1–4,096 (limits page). Anything else, a
 * fraction and `NaN` included, is rejected.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION`.
 *
 * Guarantees: runs before any embedding call, so an impossible write never
 * pays for a billable embed.
 */
export function assertVectorDimension(
  dimension: number,
  operation: string,
  scope: StoreScope,
): void {
  if (!Number.isInteger(dimension) || dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) {
    fail(
      `Vector dimension must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION} ` +
        `(received ${renderValue(dimension)}).`,
      operation,
      scope,
    );
  }
}

/**
 * Reject vector data AWS would refuse.
 *
 * Accepts:
 * - `vectors` — every vector in one batch. An empty batch passes.
 * - `opts.distanceMetric` — selects the zero-norm rule, which applies to
 *   `cosine` only.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION`, naming the vector's
 * position in the batch and the offending component's position, for
 * - a non-finite component. "Invalid values such as NaN (Not a Number) or
 *   Infinity aren't allowed"
 *   (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutInputVector.html).
 * - a zero-norm vector on a `cosine` index: "cosine distance does not support
 *   vectors with zero norm" (docs/evidence/zero-vector.md). The service
 *   message names cosine specifically, so a `euclidean` index is not covered
 *   by that evidence and is not checked.
 *
 * Guarantees: every vector is checked, not only the first — a single bad
 * component fails the whole `PutVectors` batch, so checking one would leave
 * the expensive failure exactly where it is.
 */
export function assertVectorsWritable(
  vectors: readonly (readonly number[])[],
  opts: { operation: string; distanceMetric: DistanceMetric } & StoreScope,
): void {
  const { operation, distanceMetric, ...scope } = opts;
  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i]!;
    let sumOfSquares = 0;
    for (let j = 0; j < vector.length; j++) {
      const component = vector[j]!;
      if (!Number.isFinite(component)) {
        fail(
          `Vector at index ${i} has a non-finite component at position ${j} ` +
            `(${renderValue(component)}). S3 Vectors rejects NaN and Infinity.`,
          operation,
          scope,
        );
      }
      sumOfSquares += component * component;
    }
    if (distanceMetric === 'cosine' && sumOfSquares === 0) {
      fail(
        `Vector at index ${i} has zero norm, which a cosine index rejects. An embeddings ` +
          'model handed an empty string, or a normalisation dividing by a zero norm, ' +
          'produces this.',
        operation,
        scope,
      );
    }
  }
}
