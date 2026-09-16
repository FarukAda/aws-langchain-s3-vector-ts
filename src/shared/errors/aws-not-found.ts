/**
 * Whether `error` is an AWS "not there" exception.
 *
 * Accepts: any thrown value, including a non-object.
 *
 * Returns: `true` for `NotFoundException`, the name S3 Vectors uses for a
 * missing bucket or index. Absence is an expected outcome in two places — index
 * detection during a write, and `deleteIndex()` against an index already gone —
 * which is what this predicate exists to recognise.
 *
 * `ResourceNotFoundException`, the name other AWS services use, is deliberately
 * **not** accepted. S3 Vectors declares thirteen exceptions and that is not one
 * of them, so it cannot arrive from the service; and `classify.ts`, whose table
 * is exactly those thirteen, gave it `AWS_REQUEST_FAILED`. Accepting it here
 * meant the two modules disagreed about the same value, with no reachable
 * trigger to expose it. Worse, if it ever did arrive — from a proxy, a
 * middleware, a mocked client — that is not evidence an index is gone, and
 * creating one on the strength of it is the wrong recovery.
 *
 * Throws: nothing.
 */
export function isAwsNotFoundException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'NotFoundException';
}
