import { describe, it, expect } from '@jest/globals';

import * as publicApi from '../src/index.js';
import {
  AmazonS3Vectors,
  AmazonS3VectorsRetriever,
  cosineRelevanceScoreFn,
  isS3VectorsError,
  S3VectorsError,
  S3VectorsErrorCode,
} from '../src/index.js';

/**
 * The export set is the API surface a `1.x` release promises to keep, so
 * it is pinned exactly: an accidental export is as much a breaking change as
 * an accidental removal, because a minor may add but only a major may remove.
 */
describe('public exports', () => {
  it('exposes exactly the documented runtime surface', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'AmazonS3Vectors',
      'AmazonS3VectorsRetriever',
      'S3VectorsError',
      'S3VectorsErrorCode',
      'cosineRelevanceScoreFn',
      'isS3VectorsError',
    ]);
  });

  it('exposes each one as the kind of thing it is documented to be', () => {
    expect(typeof AmazonS3Vectors).toBe('function');
    expect(typeof AmazonS3VectorsRetriever).toBe('function');
    expect(typeof S3VectorsError).toBe('function');
    expect(typeof isS3VectorsError).toBe('function');
    expect(typeof cosineRelevanceScoreFn).toBe('function');
    expect(S3VectorsErrorCode.VALIDATION).toBe('VALIDATION');
  });
});
