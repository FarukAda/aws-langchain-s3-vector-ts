import { describe, it, expect } from '@jest/globals';

import { chunk } from '../../src/shared/batching.js';

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
