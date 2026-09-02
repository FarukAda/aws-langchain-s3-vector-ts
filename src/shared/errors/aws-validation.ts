/**
 * Type guard for the AWS SDK's `ValidationException` — the shape S3 Vectors
 * uses for a request it understood but refused (a dimension that doesn't
 * match the index, an oversized metadata object, a zero vector on a cosine
 * index, and so on).
 */
export function isAwsValidationException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'ValidationException';
}
