import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import {
  assertIdsWellFormed,
  assertKeysWellFormed,
  type KeyCheckOptions,
  resolveWriteIds,
} from '../../src/internal/ids.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of `resolveWriteIds` and `assertIdsWellFormed`.
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

const withId = (id: string | undefined): Document => {
  const d = new Document({ pageContent: 'x' });
  if (id !== undefined) d.id = id;
  return d;
};

describe('resolveWriteIds', () => {
  it("returns the caller's values, in its own array", () => {
    const supplied = ['a', 'b'];
    const resolved = resolveWriteIds([withId('ignored')], supplied);
    expect(resolved).toEqual(['a', 'b']);
    // A copy, not the instance. The list is validated once and then re-read per
    // batch as each one is dispatched, so against the caller's own array those
    // two moments can disagree — and it is also the record handed back on
    // success, which a later mutation would otherwise rewrite.
    expect(resolved).not.toBe(supplied);
  });

  it('returns the values even when the length disagrees, which the caller checks', () => {
    expect(resolveWriteIds([withId(undefined)], [])).toEqual([]);
  });

  it("uses each document's own id when no list is supplied", () => {
    expect(resolveWriteIds([withId('doc-1'), withId('doc-2')], undefined)).toEqual([
      'doc-1',
      'doc-2',
    ]);
  });

  it('generates a uuid only for a document with no id at all', () => {
    const [generated, own] = resolveWriteIds([withId(undefined), withId('mine')], undefined);
    expect(generated).toMatch(/^[0-9a-f]{32}$/);
    expect(own).toBe('mine');
  });

  it('keeps an empty-string id rather than minting an unrelated key for caller data gone wrong', () => {
    expect(resolveWriteIds([withId('')], undefined)).toEqual(['']);
  });

  it('generates a distinct id per document', () => {
    const [a, b] = resolveWriteIds([withId(undefined), withId(undefined)], undefined);
    expect(a).not.toBe(b);
  });
});

const OPTS: KeyCheckOptions = { operation: 'addVectors', ...SCOPE, source: 'options.ids' };
const contextOf = (e: unknown): Record<string, unknown> =>
  (e as { context: Record<string, unknown> }).context;

describe('assertIdsWellFormed', () => {
  const check = (ids: readonly unknown[], opts: KeyCheckOptions = OPTS): unknown =>
    thrownBy(() => {
      assertIdsWellFormed(ids, opts);
    });

  it('accepts unique non-empty ids', () => {
    expect(check(['a', 'b', 'c'])).toBeUndefined();
  });

  it('accepts an id at the 1024-character boundary', () => {
    expect(check(['x'.repeat(1024)])).toBeUndefined();
  });

  it('accepts a surrogate pair, which AWS decodes', () => {
    expect(check(['k😀'])).toBeUndefined();
  });

  it('rejects an id over 1024 characters, the documented key maximum', () => {
    const error = check(['x'.repeat(1025)]);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('1025 characters');
    expect((error as Error).message).toContain('1024-character maximum for a vector key');
  });

  it('rejects an empty-string id', () => {
    const error = check(['']);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(
      'is an empty string, but every id must be a non-empty string',
    );
  });

  it('rejects a non-string id that slipped past the type system', () => {
    const error = check([42]);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('is not a string (received number)');
    // And says where the ids came from, which decides who has to fix it: the
    // caller's own list, or the documents they passed.
    expect((error as Error).message).toContain('Ids were taken from options.ids.');
  });

  it('rejects an id with an unpaired surrogate, which S3 Vectors cannot decode (T3-15)', () => {
    const error = check(['ok', 'k\ud800']);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(
      'Vector id at index 1 contains an unpaired UTF-16 surrogate at position 1.',
    );
  });

  it('rejects a duplicate within one call, which the two paths punish differently', () => {
    const error = check(['a', 'b', 'a']);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('Vector id at index 2 repeats the id at index 0');
    expect((error as Error).message).toMatch(/duplicate/i);
    // The message says what each path would have done and what to do instead. On
    // a write the failure is silent, so it has to be spelled out; on a delete
    // `DeleteVectors` refuses the request outright.
    expect((error as Error).message).toContain('silently overwrites the');
    expect((error as Error).message).toContain('must not contain duplicate keys');
    expect((error as Error).message).toContain('write it in a separate call');
  });

  it('carries the position, and — for a string — the id itself (R3)', () => {
    expect(contextOf(check(['a', '']))).toEqual({
      operation: 'addVectors',
      vectorBucketName: 'b',
      indexName: 'i',
      recordIndex: 1,
      recordId: '',
    });
    expect(contextOf(check(['a', 42]))).toEqual({
      operation: 'addVectors',
      vectorBucketName: 'b',
      indexName: 'i',
      recordIndex: 1,
    });
    expect(contextOf(check(['a', 'b', 'a']))).toMatchObject({ recordIndex: 2, recordId: 'a' });
  });

  it('names the source it was given', () => {
    const error = check([''], { ...OPTS, source: 'params.ids' });
    expect((error as Error).message).toContain('Ids were taken from params.ids.');
  });
});

describe('assertKeysWellFormed', () => {
  it('allows a repeated id, which GetVectors accepts', () => {
    expect(() => {
      assertKeysWellFormed(['a', 'a'], OPTS);
    }).not.toThrow();
  });

  it.each([
    ['not a string', [7]],
    ['empty', ['']],
    ['over 1024 characters', ['x'.repeat(1025)]],
    ['not well-formed UTF-16', ['\udc00']],
  ])('refuses an id that is %s', (_label, ids) => {
    expect(
      codeOf(
        thrownBy(() => {
          assertKeysWellFormed(ids, OPTS);
        }),
      ),
    ).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('refuses a hole, which reads as undefined', () => {
    const holed: unknown[] = [];
    holed[1] = 'a';
    const error = thrownBy(() => {
      assertKeysWellFormed(holed, OPTS);
    });
    expect((error as Error).message).toContain(
      'Vector id at index 0 is not a string (received undefined)',
    );
  });
});
