import { describe, it, expect } from '@jest/globals';

import { chunk, offsetBatches } from '../../src/shared/batching.js';

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
