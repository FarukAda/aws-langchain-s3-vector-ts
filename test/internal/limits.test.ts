import { describe, it, expect } from '@jest/globals';

import {
  assertQueryVector,
  assertWriteVectors,
  vectorRejectionReason,
} from '../../src/internal/limits.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';

/**
 * One test per domain cell of the vector rules: the limits page (dimension),
 * the PutInputVector API reference (finite components), and
 * docs/evidence/zero-vector.md (zero norm on cosine).
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const thrownBy = (fn: () => void): S3VectorsError | undefined => {
  try {
    fn();
    return undefined;
  } catch (e: unknown) {
    return e as S3VectorsError;
  }
};

describe('vectorRejectionReason', () => {
  it.each([
    ['an ordinary vector', [1, 0, 0]],
    ['a single component', [0.5]],
    ['4096 components', Array.from({ length: 4096 }, () => 0.1)],
    ['a mostly-zero vector with a non-zero norm', [0, 0, 0.0001]],
  ])('accepts %s', (_label, vector) => {
    expect(vectorRejectionReason(vector, 'cosine')).toBeUndefined();
  });

  it.each([
    ['null', null, 'is not an array (received null)'],
    ['a string', '1,2,3', 'is not an array (received a string)'],
    [
      'a typed array',
      new Float32Array([1, 2]),
      'is not an array (received a Float32Array instance)',
    ],
    [
      'an empty vector',
      [],
      'has dimension 0, but a vector must have between 1 and 4096 components',
    ],
    ['4097 components', Array.from({ length: 4097 }, () => 0.1), 'has dimension 4097'],
    [
      'NaN',
      [1, Number.NaN],
      'has a component at position 1 that is not a finite number (received NaN). S3 Vectors rejects NaN and Infinity',
    ],
    [
      '-Infinity',
      [Number.NEGATIVE_INFINITY],
      'at position 0 that is not a finite number (received -Infinity)',
    ],
    ['a string component', ['1'], 'at position 0 that is not a finite number (received a string)'],
  ])('refuses %s', (_label, vector, reason) => {
    expect(vectorRejectionReason(vector, 'cosine')).toContain(reason);
  });

  it('refuses a hole, which reads as undefined', () => {
    const holed: number[] = [1];
    holed[2] = 3;
    expect(vectorRejectionReason(holed, 'cosine')).toContain(
      'at position 1 that is not a finite number (received undefined)',
    );
  });

  it('refuses zero norm on a cosine index, naming the two ways it happens', () => {
    const reason = vectorRejectionReason([0, 0, 0], 'cosine');
    expect(reason).toContain('has zero norm, which a cosine index rejects');
    expect(reason).toContain('empty string');
    expect(reason).toContain('dividing by a zero norm');
  });

  it('accepts zero norm on a euclidean index, because the evidence covers cosine only', () => {
    expect(vectorRejectionReason([0, 0, 0], 'euclidean')).toBeUndefined();
  });
});

describe('assertWriteVectors', () => {
  const opts = (offset: number, ids: string[]) => ({
    operation: 'addVectors',
    ...SCOPE,
    distanceMetric: 'cosine' as const,
    offset,
    ids,
  });

  it('accepts vectors that share a dimension, and an empty list', () => {
    expect(
      thrownBy(() => {
        assertWriteVectors(
          [
            [1, 0],
            [0, 1],
          ],
          opts(0, ['a', 'b']),
        );
      }),
    ).toBeUndefined();
    expect(
      thrownBy(() => {
        assertWriteVectors([], opts(0, []));
      }),
    ).toBeUndefined();
  });

  it('names a refused vector by its position in the whole input, and its id (R3)', () => {
    const error = thrownBy(() => {
      assertWriteVectors(
        [
          [1, 0],
          [Number.NaN, 0],
        ],
        opts(400, ['ticket-400', 'ticket-401']),
      );
    });
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toBe(
      'Vector at index 401 (id "ticket-401") has a component at position 0 that is not a ' +
        'finite number (received NaN). S3 Vectors rejects NaN and Infinity.',
    );
    expect(error?.context).toEqual({
      operation: 'addVectors',
      ...SCOPE,
      recordIndex: 401,
      recordId: 'ticket-401',
    });
  });

  it('refuses a null after the first vector as VALIDATION, not a TypeError (R8)', () => {
    const error = thrownBy(() => {
      assertWriteVectors([[1, 0], null], opts(0, ['a', 'b']));
    });
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toContain('Vector at index 1 (id "b") is not an array (received null)');
  });

  it('refuses a dimension that differs from the first vector as INDEX_CONFIG_MISMATCH', () => {
    const error = thrownBy(() => {
      assertWriteVectors(
        [
          [1, 0, 0],
          [1, 0],
        ],
        opts(10, ['a', 'b']),
      );
    });
    expect(error?.code).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(error?.message).toBe(
      'Vector at index 11 (id "b") has dimension 2, but the vector at index 10 has ' +
        'dimension 3. Every vector written to one index must share its dimension.',
    );
    expect(error?.context).toMatchObject({ recordIndex: 11, recordId: 'b' });
  });

  it('reports what is broken about a vector before comparing its dimension', () => {
    const error = thrownBy(() => {
      assertWriteVectors([[1, 0, 0], [Number.NaN]], opts(0, ['a', 'b']));
    });
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('assertQueryVector', () => {
  const opts = {
    operation: 'similaritySearchVectorWithScore',
    ...SCOPE,
    distanceMetric: 'cosine' as const,
  };

  it('accepts an ordinary vector', () => {
    expect(
      thrownBy(() => {
        assertQueryVector([0.1, 0.2], opts);
      }),
    ).toBeUndefined();
  });

  it('refuses what the write rules refuse, naming it a query vector and no record', () => {
    const error = thrownBy(() => {
      assertQueryVector([0, 0], opts);
    });
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.message).toMatch(/^Query vector has zero norm, which a cosine index rejects/);
    expect(error?.context).toEqual({ operation: 'similaritySearchVectorWithScore', ...SCOPE });
  });
});
