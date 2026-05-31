import { describe, it, expect } from '@jest/globals';

import {
  AmazonS3Vectors,
  cosineRelevanceScoreFn,
  isS3VectorsError,
  S3VectorsError,
  S3VectorsErrorCode,
} from '../src/index.js';

describe('public exports', () => {
  it('exposes the documented surface', () => {
    expect(typeof AmazonS3Vectors).toBe('function');
    expect(typeof S3VectorsError).toBe('function');
    expect(typeof isS3VectorsError).toBe('function');
    expect(typeof cosineRelevanceScoreFn).toBe('function');
    expect(S3VectorsErrorCode.VALIDATION).toBe('VALIDATION');
  });
});
