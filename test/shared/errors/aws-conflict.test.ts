import { describe, it, expect } from '@jest/globals';

import { isAwsConflictException } from '../../../src/shared/errors/aws-conflict.js';

describe('isAwsConflictException', () => {
  it('is true for a ConflictException-named error', () => {
    expect(isAwsConflictException({ name: 'ConflictException' })).toBe(true);
  });

  it('is false for other error names and non-objects', () => {
    expect(isAwsConflictException({ name: 'NotFoundException' })).toBe(false);
    expect(isAwsConflictException(null)).toBe(false);
    expect(isAwsConflictException('ConflictException')).toBe(false);
  });
});
