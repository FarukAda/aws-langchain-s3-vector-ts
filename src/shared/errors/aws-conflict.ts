/** Type guard for the AWS SDK's ConflictException (e.g. duplicate CreateIndex). */
export function isAwsConflictException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'ConflictException';
}
