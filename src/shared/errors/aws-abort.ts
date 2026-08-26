/** Type guard for the AWS SDK HTTP handler's abort error (thrown when an `abortSignal` fires). */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'AbortError';
}
