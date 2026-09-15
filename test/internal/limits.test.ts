import { describe, it, expect } from '@jest/globals';

import { assertVectorDimension, assertVectorsWritable } from '../../src/internal/limits.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';

/**
 * One test per domain cell of the write-path limit checks
 * (docs/CONTRACTS-DRAFT.md, "internal/limits — write path").
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

const thrownBy = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('assertVectorDimension', () => {
  it.each([0, -1, 4097, 1.5, Number.NaN])('rejects %p', (dimension) => {
    const error = thrownBy(() => {
      assertVectorDimension(dimension, 'addVectors', SCOPE);
    });
    expect(isS3VectorsError(error)).toBe(true);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('names the range and what it got', () => {
    const error = thrownBy(() => {
      assertVectorDimension(0, 'addVectors', SCOPE);
    });
    expect((error as Error).message).toBe(
      'Vector dimension must be an integer between 1 and 4096 (received 0).',
    );
  });

  it.each([1, 384, 1536, 4096])('accepts %p', (dimension) => {
    expect(() => {
      assertVectorDimension(dimension, 'addVectors', SCOPE);
    }).not.toThrow();
  });
});

describe('assertVectorsWritable', () => {
  const opts = { operation: 'addVectors', distanceMetric: 'cosine' as const, ...SCOPE };

  it('accepts ordinary finite vectors', () => {
    expect(() => {
      assertVectorsWritable(
        [
          [1, 0, 0],
          [0.5, -0.25, 0.1],
        ],
        opts,
      );
    }).not.toThrow();
  });

  it('accepts an empty batch', () => {
    expect(() => {
      assertVectorsWritable([], opts);
    }).not.toThrow();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s, which AWS documents as disallowed', (_label, bad) => {
    const error = thrownBy(() => {
      assertVectorsWritable([[1, 0, bad]], opts);
    });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('S3 Vectors rejects NaN and Infinity');
  });

  it('names the vector and the component so the caller can find it', () => {
    const error = thrownBy(() => {
      assertVectorsWritable(
        [
          [1, 0, 0],
          [0, Number.NaN, 0],
        ],
        opts,
      );
    });
    const message = (error as Error).message;
    expect(message).toContain('1');
    expect(message).toContain('NaN');
  });

  it('checks every vector, not only the first, because one bad component fails the whole batch', () => {
    const error = thrownBy(() => {
      assertVectorsWritable(
        [
          [1, 0, 0],
          [1, 0, 0],
          [1, 0, Number.NaN],
        ],
        opts,
      );
    });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a zero vector on a cosine index, which AWS refuses for zero norm', () => {
    const error = thrownBy(() => {
      assertVectorsWritable([[0, 0, 0]], opts);
    });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('norm');
    // Names the two ways this actually happens, because the vector itself
    // tells the caller nothing about where it came from.
    expect((error as Error).message).toContain('empty string');
    expect((error as Error).message).toContain('dividing by a zero norm');
    expect((error as Error).message).toContain('produces this.');
  });

  it('accepts a zero vector on a euclidean index, because the evidence covers cosine only', () => {
    expect(() => {
      assertVectorsWritable([[0, 0, 0]], { ...opts, distanceMetric: 'euclidean' });
    }).not.toThrow();
  });

  it('accepts a vector that is mostly zeros but has a non-zero norm', () => {
    expect(() => {
      assertVectorsWritable([[0, 0, 0.0001]], opts);
    }).not.toThrow();
  });
});
