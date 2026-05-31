/** Type guard for AWS SDK NotFoundException-shaped errors. */
export function isAwsNotFoundException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}
