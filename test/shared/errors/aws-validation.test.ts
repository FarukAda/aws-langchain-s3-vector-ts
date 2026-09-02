import { describe, it, expect } from '@jest/globals';

import { isAwsValidationException } from '../../../src/shared/errors/aws-validation.js';

describe('isAwsValidationException', () => {
  it('is true for a ValidationException-named error', () => {
    expect(isAwsValidationException({ name: 'ValidationException' })).toBe(true);
  });

  it('is false for other error names and non-objects', () => {
    expect(isAwsValidationException({ name: 'NotFoundException' })).toBe(false);
    expect(isAwsValidationException(null)).toBe(false);
    expect(isAwsValidationException(undefined)).toBe(false);
    expect(isAwsValidationException('ValidationException')).toBe(false);
  });
});
