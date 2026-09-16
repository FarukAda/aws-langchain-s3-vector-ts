import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const PAGE_CONTENT_KEY = '_page_content';

describe('buildPutMetadata', () => {
  it('stores pageContent under the key when key is set', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(
      buildPutMetadata(doc, {
        pageContentMetadataKey: PAGE_CONTENT_KEY,
        nonFilterableKeys: [PAGE_CONTENT_KEY],
        operation: 'addDocuments',
        vectorBucketName: 'b',
        indexName: 'i',
        record: { recordIndex: 0 },
      }),
    ).toEqual({
      genre: 'scifi',
      [PAGE_CONTENT_KEY]: 'hello',
    });
  });

  it('omits pageContent when key is null', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(
      buildPutMetadata(doc, {
        pageContentMetadataKey: null,
        nonFilterableKeys: [],
        operation: 'addDocuments',
        vectorBucketName: 'b',
        indexName: 'i',
        record: { recordIndex: 0 },
      }),
    ).toEqual({ genre: 'scifi' });
  });

  it('throws when document metadata already contains the reserved page-content key', () => {
    const doc = new Document({
      pageContent: 'hello',
      metadata: { [PAGE_CONTENT_KEY]: 'user value', genre: 'scifi' },
    });
    expect(() =>
      buildPutMetadata(doc, {
        pageContentMetadataKey: PAGE_CONTENT_KEY,
        nonFilterableKeys: [PAGE_CONTENT_KEY],
        operation: 'addDocuments',
        vectorBucketName: 'b',
        indexName: 'i',
        record: { recordIndex: 0 },
      }),
    ).toThrow(`reserved key '${PAGE_CONTENT_KEY}'`);
    // The remedy matters more than the diagnosis: a caller whose documents
    // already carry that field has two ways out, and neither is obvious.
    expect(() =>
      buildPutMetadata(new Document({ pageContent: 'x', metadata: { [PAGE_CONTENT_KEY]: 'y' } }), {
        pageContentMetadataKey: PAGE_CONTENT_KEY,
        nonFilterableKeys: [],
        operation: 'addVectors',
        vectorBucketName: 'b',
        indexName: 'i',
        record: { recordIndex: 0 },
      }),
    ).toThrow('Rename this metadata field or configure a different `pageContentMetadataKey`');
  });
});

describe('createDocument', () => {
  it('restores pageContent and strips the key from metadata', () => {
    const doc = createDocument(
      { key: 'id-1', metadata: { genre: 'scifi', [PAGE_CONTENT_KEY]: 'hello' } },
      PAGE_CONTENT_KEY,
    );
    expect(doc.pageContent).toBe('hello');
    expect(doc.id).toBe('id-1');
    expect(doc.metadata).toEqual({ genre: 'scifi' });
  });

  it('falls back to empty pageContent when stored value is not a string', () => {
    const doc = createDocument(
      { key: 'id-2', metadata: { [PAGE_CONTENT_KEY]: 123 } },
      PAGE_CONTENT_KEY,
    );
    expect(doc.pageContent).toBe('');
  });

  it('leaves metadata untouched when the key is absent', () => {
    const doc = createDocument({ key: 'id-3', metadata: { genre: 'scifi' } }, PAGE_CONTENT_KEY);
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ genre: 'scifi' });
  });

  it('treats missing metadata as an empty object', () => {
    const doc = createDocument({ key: 'id-4' }, PAGE_CONTENT_KEY);
    expect(doc.metadata).toEqual({});
  });

  it('deep-copies metadata always, so no returned document can alias another', () => {
    const shared = { genre: 'scifi' };
    const doc = createDocument({ key: 'id-5', metadata: shared }, null);
    (doc.metadata as { genre: string }).genre = 'mutated';
    expect(shared.genre).toBe('scifi');
  });

  it('never strips the key when pageContentMetadataKey is null', () => {
    const doc = createDocument({ key: 'id-6', metadata: { [PAGE_CONTENT_KEY]: 'kept' } }, null);
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ [PAGE_CONTENT_KEY]: 'kept' });
  });
});

describe('buildPutMetadata / createDocument — prototype-chain safety', () => {
  it('buildPutMetadata does not treat an inherited Object.prototype member as an existing key', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(() =>
      buildPutMetadata(doc, {
        pageContentMetadataKey: 'constructor',
        nonFilterableKeys: ['constructor'],
        operation: 'addDocuments',
        vectorBucketName: 'b',
        indexName: 'i',
        record: { recordIndex: 0 },
      }),
    ).not.toThrow();
    const result = buildPutMetadata(doc, {
      pageContentMetadataKey: 'constructor',
      nonFilterableKeys: ['constructor'],
      operation: 'addDocuments',
      vectorBucketName: 'b',
      indexName: 'i',
      record: { recordIndex: 0 },
    });
    expect(result['constructor']).toBe('hello');
    expect(result['genre']).toBe('scifi');
  });

  it('createDocument does not treat an inherited Object.prototype member as present metadata', () => {
    const doc = createDocument({ key: 'v1', metadata: { genre: 'scifi' } }, 'constructor');
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ genre: 'scifi' });
  });
});

describe('createDocument — structuredClone safety', () => {
  it('throws a coded S3VectorsError instead of an uncaught exception for non-cloneable metadata', () => {
    const vector = { key: 'v1', metadata: { fn: () => 'not cloneable' } };
    let thrown: unknown;
    try {
      createDocument(vector, '_page_content', 'getByIds');
      throw new Error('should have thrown');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isS3VectorsError(thrown)).toBe(true);
    expect((thrown as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((thrown as S3VectorsError).message).toContain("vector 'v1'");
    // Says what kind of value broke it and what the caller must do, since a
    // structuredClone failure names nothing on its own.
    expect((thrown as S3VectorsError).message).toContain(
      'structured-cloned (e.g. a function or symbol)',
    );
    expect((thrown as S3VectorsError).message).toContain(
      'Ensure vector metadata contains only structured-cloneable values',
    );
  });

  it('still deep-copies cloneable metadata correctly (regression, unaffected by the try/catch)', () => {
    const shared = { nested: { value: 'original' } };
    const doc1 = createDocument({ key: 'v1', metadata: shared }, null);
    const doc2 = createDocument({ key: 'v1', metadata: shared }, null);
    (doc1.metadata['nested'] as { value: string }).value = 'mutated';
    expect((doc2.metadata['nested'] as { value: string }).value).toBe('original');
  });
});

describe('createDocument — a null page-content key reads no metadata at all', () => {
  it('leaves a metadata key literally named "null" where it is', () => {
    // `null` disables the round-trip entirely. It must not degrade into a
    // lookup for the *string* "null", which is what property access would
    // coerce it to — a document carrying that field would otherwise have it
    // silently moved into pageContent and deleted from metadata.
    const doc = createDocument({ key: 'k', metadata: { null: 'not page content' } }, null);
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ null: 'not page content' });
  });

  it('returns empty page content and the metadata untouched for an ordinary document', () => {
    const doc = createDocument({ key: 'k', metadata: { _page_content: 'stored', tag: 'a' } }, null);
    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ _page_content: 'stored', tag: 'a' });
  });
});

describe('createDocument — the operation it names when the caller supplies none', () => {
  it('defaults to its own name, so the error still says what was running', () => {
    const uncloneable = { fn: () => undefined } as unknown as Record<string, unknown>;
    let thrown: unknown;
    try {
      createDocument({ key: 'v1', metadata: uncloneable }, null);
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as S3VectorsError).context.operation).toBe('createDocument');
  });
});

describe('createDocument — a non-string value under the reserved key', () => {
  // Reachable when something other than this library writes to the same
  // index (this library's own reserved-key guard prevents it on the write
  // path). The empty pageContent is intentional and long-tested; silently
  // deleting the raw value from metadata was not.
  it('keeps the value in metadata instead of dropping it', () => {
    const doc = createDocument(
      { key: 'v1', metadata: { _page_content: 12345, other: 'kept' } },
      '_page_content',
    );

    expect(doc.pageContent).toBe('');
    expect(doc.metadata).toEqual({ _page_content: 12345, other: 'kept' });
  });

  it('still consumes and removes a string value', () => {
    const doc = createDocument(
      { key: 'v1', metadata: { _page_content: 'hello', other: 'kept' } },
      '_page_content',
    );

    expect(doc.pageContent).toBe('hello');
    expect(doc.metadata).toEqual({ other: 'kept' });
  });
});

const RECORD_OPTIONS = {
  pageContentMetadataKey: PAGE_CONTENT_KEY,
  nonFilterableKeys: [PAGE_CONTENT_KEY],
  operation: 'addDocuments',
  vectorBucketName: 'b',
  indexName: 'i',
  record: { recordIndex: 400, recordId: 'ticket-400' },
} as const;

const refusalOf = (run: () => unknown): S3VectorsError => {
  try {
    run();
  } catch (error: unknown) {
    return error as S3VectorsError;
  }
  throw new Error('expected a refusal');
};

const buildWith = (metadata: Record<string, unknown>): Record<string, unknown> =>
  buildPutMetadata(new Document({ pageContent: 'p', metadata }), RECORD_OPTIONS);

describe('buildPutMetadata — arrays (docs/evidence/metadata-value-types.md, T3-14)', () => {
  it('refuses an empty array, which S3 Vectors rejects', () => {
    const error = refusalOf(() => buildWith({ tags: [] }));
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain("Metadata key 'tags' is an empty array");
    expect(error.message).toContain('Empty arrays are not allowed in metadata');
  });

  it.each([
    ['a number first', [1, 'a'], 'a string at index 1, a number at index 0'],
    ['a string first', ['a', 1], 'a string at index 0, a number at index 1'],
    ['several of each', ['a', 'b', 2, 3], 'a string at index 0, a number at index 2'],
  ])('refuses an array mixing strings and numbers, %s', (_label, refs, positions) => {
    const error = refusalOf(() => buildWith({ refs }));
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain(`mixes strings and numbers (${positions})`);
  });

  it.each([
    ['strings', ['a', 'b']],
    ['numbers', [1, 2.5]],
    ['one empty string', ['']],
    ['a repeated element', ['dup', 'dup']],
  ])('accepts an array of %s', (_label, value) => {
    expect(buildWith({ value })['value']).toEqual(value);
  });

  it("copies an array, so the caller's own can change without changing what was validated", () => {
    const tags = ['a'];
    const built = buildWith({ tags });
    tags.push('added later');
    expect(built['tags']).toEqual(['a']);
    expect(built['tags']).not.toBe(tags);
  });

  it('copies an array held under __proto__ as an own key, never as a prototype', () => {
    const metadata = JSON.parse('{"__proto__": ["a"]}') as Record<string, unknown>;
    const built = buildWith(metadata);
    expect(Object.hasOwn(built, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(built)).toBe(Object.prototype);
    expect(built['__proto__']).toEqual(['a']);
    expect(built['__proto__']).not.toBe(metadata['__proto__']);
  });
});

describe('buildPutMetadata — strings AWS cannot decode (docs/evidence/string-encoding.md, T3-15)', () => {
  it.each([
    [
      'a value',
      { title: 'x\ud800' },
      "Metadata key 'title' contains an unpaired UTF-16 surrogate at position 1.",
    ],
    [
      'an array element',
      { tags: ['ok', '\udc00'] },
      "Metadata key 'tags' has a string at index 1 that contains an unpaired UTF-16 surrogate at position 0.",
    ],
    [
      'a key',
      { ['k\ud800']: 'v' },
      'Metadata key "k\\ud800" contains an unpaired UTF-16 surrogate at position 1.',
    ],
  ])('refuses one in %s', (_label, metadata, message) => {
    const error = refusalOf(() => buildWith(metadata));
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain(message);
  });

  it('refuses one in page content, which is stored under the page-content key', () => {
    const error = refusalOf(() =>
      buildPutMetadata(new Document({ pageContent: 'cut \ud83d' }), RECORD_OPTIONS),
    );
    expect(error.message).toContain(
      "Metadata key '_page_content' contains an unpaired UTF-16 surrogate at position 4.",
    );
  });

  it('does not examine page content that is not stored', () => {
    expect(
      buildPutMetadata(new Document({ pageContent: 'cut \ud83d' }), {
        ...RECORD_OPTIONS,
        pageContentMetadataKey: null,
        nonFilterableKeys: [],
      }),
    ).toEqual({});
  });

  it('accepts a surrogate pair everywhere a string goes', () => {
    const pair = '😀';
    expect(buildWith({ [pair]: pair, tags: [pair] })).toMatchObject({ [pair]: pair, tags: [pair] });
  });
});

describe('buildPutMetadata — names the record (R3)', () => {
  it('leads every refusal with the record, and carries it in context', () => {
    const error = refusalOf(() => buildWith({ category: null }));
    expect(error.message).toMatch(
      /^Document at index 400 \(id "ticket-400"\): Metadata key 'category' has a value/,
    );
    expect(error.context).toEqual({
      operation: 'addDocuments',
      vectorBucketName: 'b',
      indexName: 'i',
      recordIndex: 400,
      recordId: 'ticket-400',
    });
  });
});
