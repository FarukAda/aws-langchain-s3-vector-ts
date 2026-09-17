import { describe, it, expect } from '@jest/globals';

import { validateFilter } from '../../src/internal/filter.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of `validateFilter`. The operator vocabulary is
 * documented and closed (userguide s3-vectors-metadata-filtering.html), and
 * docs/evidence/ filter-validation.md established that AWS rejects an unknown
 * `$`-prefixed key — including one that might have been a literal — so
 * rejecting locally refuses nothing the service would have accepted.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

const check = (filter: unknown): unknown => {
  try {
    validateFilter(filter, 'similaritySearch', SCOPE);
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('validateFilter — shape', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('accepts %s as no filter', (_label, filter) => {
    expect(check(filter)).toBeUndefined();
  });

  it.each([
    ['an array', [{ a: 1 }]],
    ['a Map', new Map()],
    ['a Date', new Date()],
    ['a string', 'genre'],
  ])('rejects %s', (_label, filter) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // Each rejection names the shape a filter must have and the way to ask
    // for no filter at all — a caller who built one dynamically needs both.
    expect((error as Error).message).toContain('must be a plain object of metadata conditions');
    expect((error as Error).message).toContain(
      'Omit the filter argument entirely to search without filtering.',
    );
  });

  it('rejects an empty object, which AWS refuses as an invalid filter', () => {
    const error = check({});
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe(
      'filter cannot be an empty object ({}) — AWS rejects this as an invalid filter. ' +
        'Omit the filter argument entirely to search without filtering.',
    );
  });

  it('accepts a prototype-less object, which is a plain filter from another realm', () => {
    const filter = Object.create(null) as Record<string, unknown>;
    filter['genre'] = 'scifi';
    expect(check(filter)).toBeUndefined();
  });
});

describe('validateFilter — operators', () => {
  it.each([
    ['implicit equality', { genre: 'scifi' }],
    ['$eq', { genre: { $eq: 'scifi' } }],
    ['$ne', { genre: { $ne: 'drama' } }],
    ['$gt', { year: { $gt: 2019 } }],
    ['$gte', { year: { $gte: 2019 } }],
    ['$lt', { year: { $lt: 2019 } }],
    ['$lte', { year: { $lte: 2019 } }],
    ['$in', { genre: { $in: ['a', 'b'] } }],
    ['$nin', { genre: { $nin: ['a'] } }],
    ['$exists', { genre: { $exists: true } }],
    ['$and', { $and: [{ a: 1 }, { b: 2 }] }],
    ['$or', { $or: [{ a: 1 }, { b: 2 }] }],
  ])('accepts %s', (_label, filter) => {
    expect(check(filter)).toBeUndefined();
  });

  it('rejects a mistyped operator, naming it', () => {
    const error = check({ genre: { $eg: 'scifi' } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('$eg');
  });

  it('rejects a $-prefixed key that looks like a literal, because AWS rejects it too', () => {
    expect(codeOf(check({ doc: { $schema: 'https://example.com' } }))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it.each([
    ['$in', { genre: { $in: [] } }],
    ['$nin', { genre: { $nin: [] } }],
  ])('rejects %s with an empty array, which the documentation forbids', (_label, filter) => {
    expect(codeOf(check(filter))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it.each([
    ['$and', { $and: [] }],
    ['$or', { $or: [] }],
  ])('rejects %s with an empty array', (_label, filter) => {
    expect(codeOf(check(filter))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it.each([
    ['$and', { $and: 'not-an-array' }],
    ['$or', { $or: { a: 1 } }],
  ])('rejects %s whose value is not an array', (_label, filter) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('must be a non-empty array');
  });

  it('rejects an unknown $-key at the top level', () => {
    const error = check({ $eg: 'x' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // Naming the valid set is the whole point: AWS answers every bad filter
    // with the string "Invalid filter" and nothing else.
    expect((error as Error).message).toContain("uses unknown operator '$eg'");
    expect((error as Error).message).toContain(
      '$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists',
    );
  });

  it('explains a comparison operator used where a field name belongs', () => {
    const error = check({ $eq: 'scifi' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain("filter uses '$eq' where a field name belongs");
    // And shows the shape that would have been right.
    expect((error as Error).message).toContain('{ year: { $eq: … } }');
    expect((error as Error).message).toContain('only $and and $or may appear on their own');
  });

  it('validates inside $and, so a mistyped operator nested one level is still caught', () => {
    const error = check({ $and: [{ a: 1 }, { b: { $eg: 2 } }] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('$eg');
  });

  it('rejects a null nested inside $and, naming it', () => {
    const error = check({ $and: [null] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('filter.$and[0] must be a plain object');
    expect((error as Error).message).toContain('received null');
  });

  it('refuses a nested object with no operator keys, which AWS rejects (T3-18)', () => {
    // This once passed through, on the reasoning that nothing measured covered
    // it. Now something has: the service answers it with "Invalid filter".
    const error = check({ doc: { title: 'x' } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe(
      "filter.doc holds 'title', which is not an operator. A field's condition object holds " +
        'only comparison operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists); ' +
        'S3 Vectors rejects anything else in it.',
    );
  });

  it.each(['$and', '$or'])(
    'refuses %s nested under a field, which AWS rejects (T3-18)',
    (operator) => {
      const error = check({ genre: { [operator]: [{ a: 1 }] } });
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect((error as Error).message).toBe(
        `filter.genre uses '${operator}' inside a field's condition. Logical operators combine ` +
          `whole conditions: { ${operator}: [{ field: … }, { field: … }] }.`,
      );
    },
  );

  it('validates inside $or too', () => {
    const error = check({ $or: [{ b: { $nin: [] } }] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The path is in the message, so a caller with a deep filter knows where.
    expect((error as Error).message).toBe('filter.$or[0].b.$nin must be a non-empty array.');
  });
});

describe('validateFilter — one condition per object (T3-17)', () => {
  it.each([
    ['two fields', { genre: 'scifi', year: 2020 }, 'filter holds 2 conditions (genre, year)'],
    [
      'a logical operator beside a field',
      { $and: [{ a: 1 }], genre: 'x' },
      'filter holds 2 conditions ($and, genre)',
    ],
    [
      'two fields inside an $and element',
      { $and: [{ a: 1, b: 2 }] },
      'filter.$and[0] holds 2 conditions (a, b)',
    ],
  ])('refuses %s, and shows the $and to write instead', (_label, filter, message) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(message);
    expect((error as Error).message).toContain(
      'but S3 Vectors takes exactly one per object. Combine them with $and',
    );
  });

  it('accepts several operators on one field', () => {
    expect(check({ price: { $gte: 10, $lte: 50 } })).toBeUndefined();
  });
});

describe("validateFilter — a field's operator object (T3-18)", () => {
  it('refuses an empty operator object', () => {
    expect((check({ genre: {} }) as Error).message).toBe(
      'filter.genre is an empty object. Give the value itself, or at least one comparison ' +
        'operator such as { $eq: … }.',
    );
  });

  it('refuses an operator beside a key that is not one', () => {
    expect((check({ genre: { $eq: 'a', x: 1 } }) as Error).message).toContain(
      "filter.genre holds 'x', which is not an operator",
    );
  });
});

describe('validateFilter — operands (T3-16)', () => {
  it.each([
    [
      '$eq holding null',
      { g: { $eq: null } },
      'filter.g.$eq must be a string, a finite number or a boolean (received null).',
    ],
    [
      '$ne holding an array',
      { g: { $ne: ['a'] } },
      'filter.g.$ne must be a string, a finite number or a boolean (received an array).',
    ],
    [
      '$gt holding a string',
      { n: { $gt: '1' } },
      'filter.n.$gt must be a finite number (received a string).',
    ],
    [
      '$lte holding a boolean',
      { n: { $lte: true } },
      'filter.n.$lte must be a finite number (received true).',
    ],
    [
      '$in holding null',
      { g: { $in: [null] } },
      'filter.g.$in has an element at index 0 that must be a string, a finite number or a boolean (received null).',
    ],
    [
      '$nin holding an object',
      { g: { $nin: ['a', {}] } },
      'filter.g.$nin has an element at index 1 that must be a string, a finite number or a boolean (received an object).',
    ],
    [
      '$in holding a nested array',
      { g: { $in: [['a']] } },
      'filter.g.$in has an element at index 0 that must be a string, a finite number or a boolean (received an array).',
    ],
    [
      '$in holding a string',
      { g: { $in: 'a' } },
      'filter.g.$in must be a non-empty array (received a string).',
    ],
    [
      '$exists holding a string',
      { g: { $exists: 'yes' } },
      'filter.g.$exists must be a boolean (received a string).',
    ],
    [
      'a shorthand null',
      { g: null },
      'filter.g must be a string, a finite number or a boolean (received null).',
    ],
    [
      'a shorthand array',
      { g: ['a'] },
      'filter.g must be a string, a finite number or a boolean (received an array).',
    ],
  ])('refuses %s', (_label, filter, message) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe(message);
  });

  it.each([
    ['$eq holding a number', { n: { $eq: 1 } }],
    ['$ne holding a boolean', { b: { $ne: false } }],
    ['$gt holding a fraction', { n: { $gt: 0.5 } }],
    ['$in holding mixed types', { g: { $in: ['a', 1, true] } }],
    ['$nin holding a boolean', { b: { $nin: [false] } }],
    ['$exists holding false', { g: { $exists: false } }],
    ['a shorthand boolean', { b: true }],
    ['an empty field name', { '': 'x' }],
  ])('accepts %s', (_label, filter) => {
    expect(check(filter)).toBeUndefined();
  });
});

describe('validateFilter — values the AWS SDK would send as something else (T3-19)', () => {
  it.each([
    [
      'NaN in $eq',
      { n: { $eq: Number.NaN } },
      'filter.n.$eq is NaN, which the AWS SDK sends as the string "NaN", so the filter would silently match nothing.',
    ],
    [
      'Infinity in $gt',
      { n: { $gt: Number.POSITIVE_INFINITY } },
      'filter.n.$gt is Infinity, which the AWS SDK sends as the string "Infinity"',
    ],
    [
      'NaN in $in',
      { n: { $in: [1, Number.NaN] } },
      'filter.n.$in has an element at index 1 that is NaN',
    ],
    ['a shorthand NaN', { n: Number.NaN }, 'filter.n is NaN'],
    [
      'a Date as the value',
      { at: new Date(0) },
      'filter.at must be a string, a finite number or a boolean (received a Date, which the AWS SDK would send as a timestamp',
    ],
    [
      'a Date in $gt',
      { at: { $gt: new Date(0) } },
      'filter.at.$gt must be a finite number (received a Date',
    ],
  ])('refuses %s', (_label, filter, message) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(message);
  });
});

describe('validateFilter — strings AWS cannot decode (T3-15)', () => {
  it.each([
    [
      'a shorthand string',
      { g: 'x\ud800' },
      'filter.g contains an unpaired UTF-16 surrogate at position 1.',
    ],
    [
      'an $in element',
      { g: { $in: ['ok', '\udc00'] } },
      'filter.g.$in has an element at index 1 that contains an unpaired UTF-16 surrogate at position 0.',
    ],
    [
      'a field name',
      { ['k\ud800']: 'x' },
      'filter has a field name that contains an unpaired UTF-16 surrogate at position 1.',
    ],
  ])('refuses one in %s', (_label, filter, message) => {
    const error = check(filter);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(message);
  });

  it('accepts a surrogate pair', () => {
    expect(check({ ['k😀']: { $in: ['😀'] } })).toBeUndefined();
  });
});
