/**
 * Whether `error` is the SDK's `ConflictException`.
 *
 * Accepts: any thrown value, including a non-object.
 *
 * Returns: `true` only for an object whose `name` is exactly
 * `'ConflictException'` — the literal type the service model declares
 * (`@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/errors.d.ts`), so
 * this is an exact test rather than a heuristic. The only operation that
 * raises it is `CreateIndex`, where it means another writer created the index
 * first: the requested state, not a failure.
 *
 * Throws: nothing.
 */
export function isAwsConflictException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'ConflictException';
}
