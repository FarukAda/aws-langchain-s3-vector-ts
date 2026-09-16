import { describe, it, expect } from '@jest/globals';

import { unpairedSurrogateReason } from '../../src/shared/utf16.js';

/**
 * One test per domain cell of `unpairedSurrogateReason`. The rule is
 * docs/evidence/string-encoding.md (T3-15): S3 Vectors fails any request
 * carrying a lone surrogate, and accepts a pair.
 */
describe('unpairedSurrogateReason', () => {
  it.each([
    ['an empty string', ''],
    ['ASCII', 'plain text'],
    ['a surrogate pair', 'emoji 😀 inside'],
    ['a pair at the very end', 'x😀'],
  ])('accepts %s', (_label, value) => {
    expect(unpairedSurrogateReason(value)).toBeUndefined();
  });

  it.each([
    ['a high surrogate at the end', 'abc\ud800', 3],
    ['a low surrogate at the start', '\udc00abc', 0],
    ['a high surrogate followed by an ordinary character', 'a\ud800b', 1],
    ['a low surrogate straight after a complete pair', '😀\udc00', 2],
    ['a high surrogate followed by another high surrogate', '\ud800𐀀', 0],
  ])('refuses %s, naming the position', (_label, value, position) => {
    const reason = unpairedSurrogateReason(value);
    expect(reason).toContain(`contains an unpaired UTF-16 surrogate at position ${position}.`);
    expect(reason).toContain('SerializationException');
  });
});
