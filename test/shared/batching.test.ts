import { describe, it, expect } from '@jest/globals';

import { chunk, offsetBatches } from '../../src/shared/batching.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

describe('chunk', () => {
  it('splits an array into groups of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size exceeds the array length', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it('returns an empty array for an empty input', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it.each([0, -1, 0.5])('rejects a size of %p rather than looping forever', (size) => {
    // `for (i = 0; i < len; i += size)` never terminates at 0 and never
    // advances at a negative size: a pure exported helper whose domain
    // contains an infinite loop is not closed, whatever its callers check.
    const error = (() => {
      try {
        chunk([1, 2, 3], size);
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('returns exact-multiple chunks with no trailing empty chunk', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('offsetBatches', () => {
  it('pairs each batch with its running offset, starting from startOffset', () => {
    expect(offsetBatches([[1, 2], [3, 4], [5]], 10)).toEqual([
      { batch: [1, 2], offset: 10 },
      { batch: [3, 4], offset: 12 },
      { batch: [5], offset: 14 },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(offsetBatches([], 5)).toEqual([]);
  });
});
