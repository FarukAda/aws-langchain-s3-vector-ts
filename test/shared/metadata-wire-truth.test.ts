import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { buildPutMetadata } from '../../src/shared/metadata.js';

/**
 * What this package counts must be what AWS receives (F-01).
 *
 * The validator and the byte counter both reason about metadata through
 * `JSON.stringify`. The SDK does not: its document serialiser writes a
 * non-finite number as the *string* `"NaN"`, and drops an array hole entirely
 * rather than writing `null` for it. So three things could disagree with the
 * wire at once — the accepted value's type, an array's length, and the byte
 * count that decides whether a write is refused locally.
 *
 * Captured against the real `S3VectorsClient` with its middleware
 * short-circuited after serialisation:
 *
 *     input  {"n":NaN, "i":Infinity}   JSON.stringify -> {"n":null,"i":null}
 *                                      wire           -> {"n":"NaN","i":"Infinity"}
 *     input  {"sparse":[1,,3]}         JSON.stringify -> {"sparse":[1,null,3]}
 *                                      wire           -> {"sparse":[1,3]}
 *
 * and the counter was wrong in both directions: 97 counted against 106 sent in
 * the first case, 117 counted against 114 sent in the second.
 *
 * The fix is not a second serialiser. It is to refuse every value whose
 * `JSON.stringify` form differs from its wire form, after which the two agree
 * by construction and the existing counter becomes truthful — which is what the
 * final test here pins.
 */

const OPTIONS = {
  pageContentMetadataKey: '_page_content',
  nonFilterableKeys: ['_page_content'],
  operation: 'addDocuments',
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

function build(metadata: Record<string, unknown>): Record<string, unknown> {
  return buildPutMetadata(new Document({ pageContent: 'p', metadata }), OPTIONS);
}

function rejectionFor(metadata: Record<string, unknown>): {
  code: string;
  message: string;
} {
  try {
    build(metadata);
  } catch (error: unknown) {
    if (!isS3VectorsError(error)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error('expected buildPutMetadata to reject, but it returned');
}

describe('metadata values that would not survive serialisation are refused', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a top-level %s, which the SDK would send as a string', (_label, value) => {
    const { code, message } = rejectionFor({ n: value });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(message).toMatch(/finite/i);
    expect(message).toContain('n');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s inside an array', (_label, value) => {
    const { code, message } = rejectionFor({ scores: [1, value, 3] });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(message).toMatch(/finite/i);
  });

  it('rejects a sparse array, which the SDK sends with the hole removed', () => {
    // `Array.prototype.every` skips holes, which is exactly why the old check
    // passed this: every *present* element was a number. Writing the hole is
    // the point of the test, so the rule against writing one is suspended here.
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3] as unknown as number[];
    const { code, message } = rejectionFor({ sparse });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(message).toMatch(/hole|missing|sparse/i);
  });

  it('rejects an explicit undefined inside an array', () => {
    const { code } = rejectionFor({ items: [1, undefined, 3] as unknown });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('still accepts the values S3 Vectors does take', () => {
    const metadata = build({
      text: 'a string',
      count: 42,
      negative: -1.5,
      zero: 0,
      flag: true,
      tags: ['a', 'b'],
      mixed: ['a', 1],
      // The largest and smallest finite doubles still serialise identically.
      big: Number.MAX_SAFE_INTEGER + 1,
      tiny: Number.MIN_VALUE,
    });
    expect(metadata['count']).toBe(42);
    expect(metadata['tags']).toEqual(['a', 'b']);
    expect(metadata['_page_content']).toBe('p');
  });

  it('accepts only metadata whose JSON form round-trips exactly', () => {
    // The invariant that makes the byte counter truthful: once a value cannot
    // change shape on the way out, `JSON.stringify` measures what is sent.
    const accepted = build({
      text: 'a string',
      count: 42,
      flag: false,
      tags: ['a', 1],
    });
    expect(JSON.parse(JSON.stringify(accepted)) as unknown).toEqual(accepted);
  });
});

describe('page content cannot be silently discarded', () => {
  it('stores page content under a key that would otherwise hit a setter', () => {
    // Assigning to `__proto__` on a plain object invokes the inherited setter
    // and stores nothing. The config validator refuses that key outright now,
    // but the write itself is also made unable to lose the value, so this
    // function is correct however it is called.
    const metadata = buildPutMetadata(new Document({ pageContent: 'IMPORTANT TEXT' }), {
      ...OPTIONS,
      pageContentMetadataKey: '__proto__',
      nonFilterableKeys: ['__proto__'],
    });
    expect(Object.hasOwn(metadata, '__proto__')).toBe(true);
    expect(JSON.stringify(metadata)).toContain('IMPORTANT TEXT');
  });
});
