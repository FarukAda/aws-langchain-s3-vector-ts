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

  it('returns true for the one name S3 Vectors actually sends', () => {
    expect(isAwsNotFoundException({ name: 'NotFoundException' })).toBe(true);
  });

  it('returns false for ResourceNotFoundException, which this service never sends', () => {
    // Other AWS services use that name; S3 Vectors declares thirteen exceptions
    // and it is not among them. Accepting it meant this predicate read a value
    // as proof an index was absent while `classify.ts` called the same value an
    // ordinary request failure — two modules disagreeing about one value, with
    // nothing able to trigger it.
    expect(isAwsNotFoundException({ name: 'ResourceNotFoundException' })).toBe(false);
  });
});
