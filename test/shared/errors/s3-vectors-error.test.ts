import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';

describe('S3VectorsError', () => {
  it('carries code, context, and cause', () => {
    const cause = new Error('boom');
    const err = new S3VectorsError(
      'failed',
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
      { operation: 'PutVectors', indexName: 'idx' },
      cause,
    );

    expect(err.message).toBe('failed');
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.context.operation).toBe('PutVectors');
    expect(err.context.indexName).toBe('idx');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('S3VectorsError');
  });

  it('omits cause when none is provided', () => {
    const err = new S3VectorsError('x', S3VectorsErrorCode.VALIDATION, { operation: 'ctor' });
    expect(err.cause).toBeUndefined();
  });

  it('is identified by the guard without instanceof', () => {
    const err = new S3VectorsError('x', S3VectorsErrorCode.VALIDATION, { operation: 'ctor' });
    expect(isS3VectorsError(err)).toBe(true);
    expect(isS3VectorsError(new Error('x'))).toBe(false);
    expect(isS3VectorsError(null)).toBe(false);
    expect(isS3VectorsError('S3VectorsError')).toBe(false);
  });
});
