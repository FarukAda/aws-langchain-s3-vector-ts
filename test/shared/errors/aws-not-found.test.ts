import { describe, it, expect } from '@jest/globals';

import { isAwsNotFoundException } from '../../../src/shared/errors/aws-not-found.js';

describe('isAwsNotFoundException', () => {
  it('returns false for non-object inputs', () => {
    expect(isAwsNotFoundException(null)).toBe(false);
    expect(isAwsNotFoundException(undefined)).toBe(false);
    expect(isAwsNotFoundException('NotFoundException')).toBe(false);
    expect(isAwsNotFoundException(42)).toBe(false);
  });

  it('returns false for an object without a matching name', () => {
    expect(isAwsNotFoundException({})).toBe(false);
    expect(isAwsNotFoundException({ name: 'ValidationException' })).toBe(false);
  });

  it('returns true for the two recognised not-found error names', () => {
    expect(isAwsNotFoundException({ name: 'NotFoundException' })).toBe(true);
    expect(isAwsNotFoundException({ name: 'ResourceNotFoundException' })).toBe(true);
  });
});
