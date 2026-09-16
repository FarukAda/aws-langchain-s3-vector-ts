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
      }),
    ).not.toThrow();
    const result = buildPutMetadata(doc, {
      pageContentMetadataKey: 'constructor',
      nonFilterableKeys: ['constructor'],
      operation: 'addDocuments',
      vectorBucketName: 'b',
      indexName: 'i',
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
