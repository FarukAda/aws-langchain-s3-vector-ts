import { describe, it, expect } from '@jest/globals';

import { cosineRelevanceScoreFn } from '../src/relevance-scores.js';

describe('Relevance score functions', () => {
  it('cosineRelevanceScoreFn converts distance to score', () => {
    expect(cosineRelevanceScoreFn(0)).toBe(1);
    expect(cosineRelevanceScoreFn(0.5)).toBe(0.5);
    expect(cosineRelevanceScoreFn(1)).toBe(0);
  });
});
