import { describe, it, expect } from '@jest/globals';

import { isTagKeyLength, isTagValueLength } from '../../src/shared/aws-limits.js';

/**
 * The tag bounds are enforced twice — on `config.tags` at construction, and
 * again at `CreateIndex` — and each site words its own refusal. What they must
 * not each have is their own copy of the rule: two comparisons, far apart,
 * agree only until one of them is edited.
 *
 * "tags … Key Length Constraints: Minimum length of 1. Maximum length of 128.
 * Value Length Constraints: Minimum length of 0. Maximum length of 256."
 * (`API_S3VectorBuckets_CreateIndex.html`).
 */
describe('the tag bounds, stated once', () => {
  it.each([
    [0, false],
    [1, true],
    [128, true],
    [129, false],
  ])('a key of %i characters is within bounds: %p', (length, expected) => {
    expect(isTagKeyLength('k'.repeat(length))).toBe(expected);
  });

  it.each([
    [0, true],
    [256, true],
    [257, false],
  ])('a value of %i characters is within bounds: %p', (length, expected) => {
    expect(isTagValueLength('v'.repeat(length))).toBe(expected);
  });
});
