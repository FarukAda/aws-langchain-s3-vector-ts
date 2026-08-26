import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { assertValidIndexConfig } from '../../src/shared/validation.js';

describe('assertValidIndexConfig', () => {
  it('accepts a valid bucket and index name', () => {
    expect(() => assertValidIndexConfig('my-bucket', 'my-index.v1')).not.toThrow();
  });

  it('rejects an empty bucket name with a coded error', () => {
    try {
      assertValidIndexConfig('', 'idx');
      throw new Error('should throw');
    } catch (e: unknown) {
      expect(isS3VectorsError(e)).toBe(true);
      expect((e as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    }
  });

  it('rejects a bucket name that is too short', () => {
    expect(() => assertValidIndexConfig('bb', 'my-index')).toThrow('3–63 characters');
  });

  it('rejects a bucket name that is too long', () => {
    expect(() => assertValidIndexConfig('a'.repeat(64), 'my-index')).toThrow('3–63 characters');
  });

  it('rejects malformed bucket names', () => {
    expect(() => assertValidIndexConfig('-bad', 'my-index')).toThrow('lowercase');
    expect(() => assertValidIndexConfig('bad-', 'my-index')).toThrow('lowercase');
    expect(() => assertValidIndexConfig('UPPER', 'my-index')).toThrow('lowercase');
    // Dots are valid in index names but not in bucket names.
    expect(() => assertValidIndexConfig('has.dot', 'my-index')).toThrow('lowercase');
  });

  it('rejects an index name that is too short', () => {
    expect(() => assertValidIndexConfig('my-bucket', 'ab')).toThrow('3–63 characters');
  });

  it('rejects an index name that is too long', () => {
    expect(() => assertValidIndexConfig('my-bucket', 'a'.repeat(64))).toThrow('3–63 characters');
  });

  it('rejects malformed index names', () => {
    expect(() => assertValidIndexConfig('my-bucket', '-bad')).toThrow('lowercase');
    expect(() => assertValidIndexConfig('my-bucket', 'bad-')).toThrow('lowercase');
    expect(() => assertValidIndexConfig('my-bucket', 'UPPER')).toThrow('lowercase');
  });
});
