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

  it('passes a nested plain object with no operator keys through as a literal value', () => {
    expect(check({ doc: { title: 'x', year: 2020 } })).toBeUndefined();
  });

  it('passes a logical operator nested under a field through, because nothing measured covers it', () => {
    // Conservative by design: rejecting on an omission would refuse what the
    // service may accept.
    expect(check({ genre: { $and: [{ a: 1 }] } })).toBeUndefined();
  });

  it('validates inside $or too', () => {
    const error = check({ $or: [{ b: { $nin: [] } }] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The path is in the message, so a caller with a deep filter knows where.
    expect((error as Error).message).toBe('filter.$or[0].b.$nin must be a non-empty array.');
  });
});
