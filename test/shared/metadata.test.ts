import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const PAGE_CONTENT_KEY = '_page_content';

describe('buildPutMetadata', () => {
  it('stores pageContent under the key when key is set', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, PAGE_CONTENT_KEY, 'addDocuments')).toEqual({
      genre: 'scifi',
      [PAGE_CONTENT_KEY]: 'hello',
    });
  });

  it('omits pageContent when key is null', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, null, 'addDocuments')).toEqual({ genre: 'scifi' });
  });

  it('throws when document metadata already contains the reserved page-content key', () => {
    const doc = new Document({
      pageContent: 'hello',
      metadata: { [PAGE_CONTENT_KEY]: 'user value', genre: 'scifi' },
    });
    expect(() => buildPutMetadata(doc, PAGE_CONTENT_KEY, 'addDocuments')).toThrow(
      `reserved key '${PAGE_CONTENT_KEY}'`,
    );
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

  it('deep-copies metadata when deepCopyMetadata is true', () => {
    const shared = { genre: 'scifi' };
    const doc = createDocument({ key: 'id-5', metadata: shared }, null, true);
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
    expect(() => buildPutMetadata(doc, 'constructor', 'addDocuments')).not.toThrow();
    const result = buildPutMetadata(doc, 'constructor', 'addDocuments');
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
      createDocument(vector, '_page_content', true, 'getByIds');
      throw new Error('should have thrown');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isS3VectorsError(thrown)).toBe(true);
    expect((thrown as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((thrown as S3VectorsError).message).toContain("vector 'v1'");
  });

  it('still deep-copies cloneable metadata correctly (regression, unaffected by the try/catch)', () => {
    const shared = { nested: { value: 'original' } };
    const doc1 = createDocument({ key: 'v1', metadata: shared }, null, true);
    const doc2 = createDocument({ key: 'v1', metadata: shared }, null, true);
    (doc1.metadata['nested'] as { value: string }).value = 'mutated';
    expect((doc2.metadata['nested'] as { value: string }).value).toBe('original');
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
