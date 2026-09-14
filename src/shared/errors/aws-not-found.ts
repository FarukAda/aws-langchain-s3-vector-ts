/**
 * Whether `error` is an AWS "not there" exception.
 *
 * Accepts: any thrown value, including a non-object.
 *
 * Returns: `true` for `NotFoundException` — the name S3 Vectors uses for a
 * missing bucket or index — and for `ResourceNotFoundException`, which other
 * AWS services use and which a caller-supplied client's middleware could
 * surface. Absence is an expected outcome in two places (index detection
 * during a write, and `delete({ deleteAll: true })` against an index already
 * gone), which is what this predicate exists to recognise.
 *
 * Throws: nothing.
 */
export function isAwsNotFoundException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}
