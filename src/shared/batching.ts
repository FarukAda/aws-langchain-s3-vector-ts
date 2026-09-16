import { renderValue } from './describe.js';
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
      `Batch size must be an integer of 1 or more (received ${renderValue(size)}).`,
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
 * Pair each batch with its starting offset into the array it was chunked from.
 *
 * Accepts: the batches in order, and the offset of the first one — which is
 * not always 0, because both write paths handle the first batch separately.
 *
 * Returns: one `{ batch, offset }` per batch, offsets running by actual batch
 * length rather than by a nominal batch size, so a short final batch cannot
 * shift the ones after it. An empty list yields an empty list.
 *
 * Throws: nothing.
 *
 * Guarantees: the offset is what lets a concurrent group slice the right ids
 * for its batch, which is what keeps a partial-failure report in document
 * order regardless of completion order.
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
