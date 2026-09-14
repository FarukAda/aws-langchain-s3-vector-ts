import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

/**
 * Split an array into consecutive chunks of at most `size` elements each.
 *
 * @param items - The array to split; an empty one yields no chunks
 * @param size - Elements per chunk, an integer of 1 or more. A size below 1
 * would make the loop below never terminate (0) or never advance (negative),
 * so it is refused here rather than only at the call sites — a pure exported
 * helper whose domain contains an infinite loop is not closed.
 * @returns The chunks, in order, with no trailing empty chunk
 * @throws {S3VectorsError} `VALIDATION` when `size` is not an integer of 1 or
 * more
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new S3VectorsError(
      `Batch size must be an integer of 1 or more (received ${String(size)}).`,
      S3VectorsErrorCode.VALIDATION,
      { operation: 'chunk' },
    );
  }
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
