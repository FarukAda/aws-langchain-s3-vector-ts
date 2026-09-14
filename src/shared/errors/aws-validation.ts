/**
 * Whether `error` is the SDK's `ValidationException`.
 *
 * Accepts: any thrown value, including a non-object.
 *
 * Returns: `true` for the shape S3 Vectors uses for a request it understood
 * but refused — a dimension that does not match the index, an oversized
 * metadata object, a zero vector on a cosine index, a malformed filter. The
 * test is on the exact `name` the service model declares, never on message
 * text.
 *
 * Throws: nothing.
 */
export function isAwsValidationException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'ValidationException';
}
