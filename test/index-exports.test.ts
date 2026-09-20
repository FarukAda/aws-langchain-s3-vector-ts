import { describe, it, expect } from '@jest/globals';

import * as publicApi from '../src/index.js';
import {
  AmazonS3Vectors,
  AmazonS3VectorsRetriever,
  cosineRelevanceScoreFn,
  flattenMetadata,
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
      'flattenMetadata',
      'isS3VectorsError',
    ]);
  });

  it('exposes exactly the documented public methods on the store', () => {
    // The suite already checked that every name it knows about exists. Nothing
    // checked the other direction: a new public method on the class was
    // outside every ledger — not pinned here, not in the conformance
    // registry's entry points, and caught by no gate. An allowlist is what
    // makes adding one a decision.
    const isInternal = (name: string): boolean => name === 'constructor' || name.startsWith('_');
    const onPrototype = Object.getOwnPropertyNames(AmazonS3Vectors.prototype)
      .filter((name) => !isInternal(name))
      .sort();

    expect(onPrototype).toEqual([
      'addDocuments',
      'addVectors',
      'asRetriever',
      'delete',
      'deleteIndex',
      'getByIds',
      'listDocuments',
      'listVectors',
      'maxMarginalRelevanceSearch',
      'similaritySearch',
      'similaritySearchVectorWithScore',
      'similaritySearchWithRelevanceScores',
      'similaritySearchWithScore',
    ]);
  });

  it('exposes exactly the documented static factories', () => {
    const statics = Object.getOwnPropertyNames(AmazonS3Vectors)
      .filter((name) => !['length', 'name', 'prototype'].includes(name))
      .sort();
    // Two, not three: `fromExistingIndex` was removed and the store is built
    // with its constructor instead. Both of these are core's own factories.
    expect(statics).toEqual(['fromDocuments', 'fromTexts']);
  });

  it('exposes each one as the kind of thing it is documented to be', () => {
    expect(typeof AmazonS3Vectors).toBe('function');
    expect(typeof AmazonS3VectorsRetriever).toBe('function');
    expect(typeof S3VectorsError).toBe('function');
    expect(typeof isS3VectorsError).toBe('function');
    expect(typeof cosineRelevanceScoreFn).toBe('function');
    expect(typeof flattenMetadata).toBe('function');
    expect(S3VectorsErrorCode.VALIDATION).toBe('VALIDATION');
  });
});
