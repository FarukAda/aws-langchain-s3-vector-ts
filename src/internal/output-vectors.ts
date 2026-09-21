/**
 * Hides that a response is not trusted until it is read.
 *
 * The SDK types say a response holds an array of vectors; the wire says whatever
 * arrived. Casting would assert the shape, so it is checked instead, once, here
 * — and every caller downstream may then treat the array as real.
 */
import { describeValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError, type S3VectorsErrorContext } from '../shared/errors/s3-vectors-error.js';
import type { StoreScope } from '../shared/scope.js';
import type { S3OutputVector } from '../types.js';

/** What a refusal here is reported under: the method, the index, and how far a listing had got. */
type ResponseContext = S3VectorsErrorContext & StoreScope;

/** Said of every response this module refuses: what is wrong with it is not the caller's input. */
const NOT_THE_CALLERS =
  'The response may be malformed, or come from an incompatible SDK version or a ' +
  'mocked/stubbed client.';

/**
 * Refuse a response that is not an object at all.
 *
 * Accepts: whatever `client.send` resolved with, the command that was sent, and
 * the context to report under — a listing passes its counters in it.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `AWS_INVALID_RESPONSE`.
 *
 * Guarantees: a client that resolves with `undefined` fails here, coded, rather
 * than as a raw `TypeError` on the first field read after it. The three reads
 * each carried their own copy of this, and the copies had already drifted apart
 * in what they reported: only the listing's said how far it had got.
 */
export function assertResponseObject(
  response: unknown,
  command: 'GetVectors' | 'QueryVectors' | 'ListVectors',
  context: ResponseContext,
): void {
  if (typeof response === 'object' && response !== null) return;
  throw new S3VectorsError(
    `${command} for index "${context.indexName}" resolved without a response object. ` +
      NOT_THE_CALLERS,
    S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    context,
  );
}

/**
 * A record's embedding, where the request asked for one.
 *
 * Accepts: the record, the command whose response carried it, and the context to
 * report under.
 *
 * Returns: the `float32` components.
 *
 * Throws: {@link S3VectorsError} with code `AWS_INVALID_RESPONSE` for a record
 * with no embedding.
 *
 * Guarantees: an empty `float32` is refused as well as a missing one. `[]`
 * satisfied a check for `undefined`, so a record with no embedding at all passed
 * as though it had one: `listVectors` yielded it, and the migration that method
 * exists for wrote dimensionless vectors into the target index and looked
 * complete; MMR ranked it.
 */
export function embeddingOf(
  vector: S3OutputVector,
  command: 'GetVectors' | 'ListVectors',
  context: ResponseContext,
): number[] {
  const data = vector.data?.float32;
  if (data !== undefined && data.length > 0) return data;
  throw new S3VectorsError(
    `${command} returned vector '${vector.key}' ${
      data === undefined ? 'without data' : 'with an empty embedding'
    }, even though this call requested returnData: true. ${NOT_THE_CALLERS}`,
    S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    context,
  );
}

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
      `${command} for index "${scope.indexName}" returned ${detail}. ${NOT_THE_CALLERS}`,
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
