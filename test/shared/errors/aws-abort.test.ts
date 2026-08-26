import { describe, it, expect } from '@jest/globals';

import { isAbortError } from '../../../src/shared/errors/aws-abort.js';

describe('isAbortError', () => {
  it('is true for an AbortError-named error', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('is false for other error names and non-objects', () => {
    expect(isAbortError({ name: 'NotFoundException' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
