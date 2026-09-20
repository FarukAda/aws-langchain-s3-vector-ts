import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { buildPutMetadata } from '../../src/shared/metadata.js';

/**
 * The metadata rules measured against live AWS (docs/evidence/) and decided in
 * its contract.
 */
const BASE = {
  pageContentMetadataKey: '_page_content',
  nonFilterableMetadataKeys: ['_page_content'] as readonly string[],
  operation: 'addVectors',
  vectorBucketName: 'b',
  indexName: 'i',
  record: { recordIndex: 0 },
};

const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;
const build = (metadata: Record<string, unknown>, opts = {}): unknown => {
  try {
    return buildPutMetadata(new Document({ pageContent: 'p', metadata }), { ...BASE, ...opts })
      .metadata;
  } catch (e) {
    return e;
  }
};

describe('buildPutMetadata — value types (docs/evidence/metadata-value-types.md)', () => {
  it.each([
    ['a string', 'x'],
    ['a number', 42],
    ['a boolean', true],
    ['an array of strings', ['a', 'b']],
    ['an array of numbers', [1, 2]],
  ])('accepts %s', (_label, value) => {
    expect(build({ k: value })).toMatchObject({ k: value });
  });

  it('rejects a nested object, which AWS refuses', () => {
    const error = build({ k: { nested: 1 } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The message lists the accepted set, because the user guide's own list
    // is looser than what the service actually takes.
    expect((error as Error).message).toContain('non-empty array of only strings or only numbers');
  });

  it('rejects an array containing an object, because arrays hold only strings or numbers', () => {
    expect(codeOf(build({ k: [{ a: 1 }] }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects an array containing a boolean, which is stricter than the user guide states', () => {
    expect(codeOf(build({ k: [true] }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects an array mixing strings and numbers, which AWS refuses (T3-14)', () => {
    expect(codeOf(build({ k: ['a', 1] }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects an empty array, which AWS refuses (T3-14)', () => {
    expect(codeOf(build({ k: [] }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a null value, which is in no accepted set', () => {
    expect(codeOf(build({ k: null }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('names the offending key', () => {
    const error = build({ good: 1, bad: { nested: true } });
    expect((error as Error).message).toContain('bad');
    expect((error as Error).message).not.toContain("'good'");
  });
});

describe('buildPutMetadata — key count', () => {
  const keys = (n: number): Record<string, unknown> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));

  it('accepts 49 caller keys plus the page-content key this package adds', () => {
    expect(Object.keys(build(keys(49)) as object)).toHaveLength(50);
  });

  it('rejects 50 caller keys, because the key this package adds makes 51', () => {
    const error = build(keys(50));
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('A vector may have at most 50 metadata keys');
    expect((error as Error).message).toContain(
      'this document needs 51, including the page-content key this package adds.',
    );
  });

  it('rejects 51 caller keys even when no page-content key is added', () => {
    const error = build(keys(51), { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).not.toContain('page-content key this package adds');
  });

  it('accepts 50 caller keys when no page-content key is added', () => {
    expect(
      Object.keys(
        build(keys(50), { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] }) as object,
      ),
    ).toHaveLength(50);
  });
});

describe('buildPutMetadata — byte limits (docs/evidence/metadata-limits.md)', () => {
  it('accepts filterable metadata just inside the measured ceiling', () => {
    // {"f":"x…"} plus the 5-byte overhead must not exceed 2048.
    const value = 'x'.repeat(2035);
    expect(
      build({ f: value }, { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] }),
    ).toMatchObject({ f: value });
  });

  it('rejects filterable metadata one byte over', () => {
    const error = build(
      { f: 'x'.repeat(2036) },
      { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] },
    );
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('2048');
    // The remedy: the 40 KB budget is reachable by declaring the key
    // non-filterable, which a caller cannot guess from a byte count.
    expect((error as Error).message).toContain(
      'declare large fields as non-filterable metadata keys on the index',
    );
    // And which keys were counted, since the store budgets against its own
    // configuration while AWS measures against the index's.
    expect((error as Error).message).toContain('no non-filterable keys');
  });

  it('counts key names, not just values', () => {
    // The same value that fits under a 1-character key does not under a longer one.
    const value = 'x'.repeat(2035);
    expect(
      codeOf(
        build(
          { ffffffffff: value },
          { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] },
        ),
      ),
    ).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('counts UTF-8 bytes, so a two-byte character costs two', () => {
    expect(
      codeOf(
        build(
          { f: 'é'.repeat(1018) },
          { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] },
        ),
      ),
    ).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('excludes non-filterable keys from the filterable budget', () => {
    // Far over 2 KB, but declared non-filterable, so only the 40 KB rule applies.
    const big = 'x'.repeat(5000);
    expect(
      build({ bulk: big }, { pageContentMetadataKey: null, nonFilterableMetadataKeys: ['bulk'] }),
    ).toMatchObject({ bulk: big });
  });

  it('rejects total metadata over the measured 40 KB ceiling', () => {
    const error = build(
      { bulk: 'x'.repeat(41000) },
      { pageContentMetadataKey: null, nonFilterableMetadataKeys: ['bulk'] },
    );
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('40960');
  });
});

describe('buildPutMetadata — page content, unchanged', () => {
  it('stores page content under the configured key', () => {
    expect(build({})).toMatchObject({ _page_content: 'p' });
  });

  it('rejects a document whose own metadata already uses the reserved key', () => {
    expect(codeOf(build({ _page_content: 'theirs' }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('stores nothing extra when the key is null', () => {
    const out = build(
      { a: 1 },
      { pageContentMetadataKey: null, nonFilterableMetadataKeys: [] },
    ) as object;
    expect(Object.keys(out)).toEqual(['a']);
  });
});
