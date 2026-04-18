import { describe, it, expect } from '@jest/globals';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from '../src/utils.js';

describe('Relevance score functions', () => {
  it('cosineRelevanceScoreFn converts distance to score', () => {
    expect(cosineRelevanceScoreFn(0)).toBe(1);
    expect(cosineRelevanceScoreFn(0.5)).toBe(0.5);
    expect(cosineRelevanceScoreFn(1)).toBe(0);
  });

  it('euclideanRelevanceScoreFn converts distance to score', () => {
    expect(euclideanRelevanceScoreFn(0)).toBe(1);
    expect(euclideanRelevanceScoreFn(Math.sqrt(4096))).toBeCloseTo(0);
  });
});
