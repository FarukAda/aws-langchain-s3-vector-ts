/** Split an array into consecutive chunks of at most `size` elements each. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Pair each batch with its starting offset into the flat array it was
 * chunked from, given the offset of the first one.
 */
export function offsetBatches<T>(
  batches: readonly T[][],
  startOffset: number,
): { batch: T[]; offset: number }[] {
  const result: { batch: T[]; offset: number }[] = [];
  let offset = startOffset;
  for (const batch of batches) {
    result.push({ batch, offset });
    offset += batch.length;
  }
  return result;
}
