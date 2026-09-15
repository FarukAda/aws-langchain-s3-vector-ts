import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { assertIdsWellFormed, resolveWriteIds } from '../../src/internal/ids.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of `resolveWriteIds` and `assertIdsWellFormed`
 * (docs/CONTRACTS-DRAFT.md, "internal/ids").
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
  it('returns the caller list verbatim when given one', () => {
    expect(resolveWriteIds([withId('ignored')], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns the caller list verbatim even when its length disagrees, which the caller checks', () => {
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

describe('assertIdsWellFormed', () => {
  const check = (ids: readonly unknown[]): unknown =>
    thrownBy(() => {
      assertIdsWellFormed(ids as string[], 'addVectors', SCOPE, true);
    });

  it('accepts unique non-empty ids', () => {
    expect(check(['a', 'b', 'c'])).toBeUndefined();
  });

  it('accepts an id at the 1024-character boundary', () => {
    expect(check(['x'.repeat(1024)])).toBeUndefined();
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
    expect((error as Error).message).toContain('Ids were taken from options.ids');
  });

  it('rejects a duplicate within one call, which AWS would silently collapse', () => {
    const error = check(['a', 'b', 'a']);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('Duplicate');
    // The message says what AWS would have done and what to do instead — the
    // failure it prevents is silent, so the explanation has to be explicit.
    expect((error as Error).message).toContain(
      'silently overwrite the earlier vector with the later one',
    );
    expect((error as Error).message).toContain('write it in a separate call');
  });

  it('names the offending index so a caller can find it in a large batch', () => {
    const error = check(['a', 'b', '']);
    expect((error as Error).message).toContain('2');
  });

  it('names options.ids as the source when the caller supplied them', () => {
    const error = thrownBy(() => {
      assertIdsWellFormed([''], 'addVectors', SCOPE, true);
    });
    expect((error as Error).message).toContain('options.ids');
  });

  it("names the documents' own ids as the source when they were derived", () => {
    const error = thrownBy(() => {
      assertIdsWellFormed([''], 'addVectors', SCOPE, false);
    });
    expect((error as Error).message).toContain('id');
  });
});
