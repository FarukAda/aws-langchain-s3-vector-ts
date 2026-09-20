/**
 * Hides that a response is not trusted until it is read.
 *
 * The SDK types say a response holds an array of vectors; the wire says whatever
 * arrived. Casting would assert the shape, so it is checked instead, once, here
 * — and every caller downstream may then treat the array as real.
 */
import { describeValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { StoreScope } from '../shared/scope.js';
import type { S3OutputVector } from '../types.js';

/**
 * The vectors a response carried, checked to actually be vectors.
 *
 * Accepts:
 * - `vectors` — the `vectors` member as it arrived. `undefined` and `null` mean
 *   an empty list: a response with no results is an ordinary answer, not a
 *   malformed one.
 * - `command` — the AWS command, named in the error so a caller can tell which
 *   response was wrong.
 *
 * Returns: the entries, typed.
 *
 * Throws: {@link S3VectorsError} with code `AWS_INVALID_RESPONSE` when
 * `vectors` is present but not an array, or when any entry is not an object.
 *
 * Guarantees: every read path goes through here rather than casting, which is
 * what the three of them used to do — `(response.vectors ?? []) as
 * S3OutputVector[]`. A cast asserts a shape instead of checking it, so a
 * response carrying `[null]` passed straight through and failed later, on the
 * first property read, as a raw `TypeError` from inside a `map`. That is
 * reachable from a proxy, a stubbed client, a mocked SDK in someone's test
 * suite, or a genuinely malformed response, and in every case a caller
 * branching on `isS3VectorsError` saw nothing it recognised.
 */
export function outputVectorsOf(
  vectors: unknown,
  command: string,
  operation: string,
  scope: StoreScope,
): S3OutputVector[] {
  if (vectors === undefined || vectors === null) return [];

  // Built and thrown at the call site rather than thrown from a helper: the
  // narrowing that follows an `Array.isArray` check does not survive a call
  // whose only claim to ending control flow is its return type.
  const invalid = (detail: string): S3VectorsError =>
    new S3VectorsError(
      `${command} for index "${scope.indexName}" returned ${detail}. The response may be ` +
        'malformed, or come from an incompatible SDK version or a mocked/stubbed client.',
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
      { operation, ...scope },
    );

  if (!Array.isArray(vectors)) {
    throw invalid(`a non-array \`vectors\` member (${describeValue(vectors)})`);
  }

  const entries: readonly unknown[] = vectors;
  for (let index = 0; index < entries.length; index++) {
    const vector: unknown = entries[index];
    if (typeof vector !== 'object' || vector === null) {
      throw invalid(`${describeValue(vector)} where vector ${index} should be`);
    }
  }

  return entries as S3OutputVector[];
}
