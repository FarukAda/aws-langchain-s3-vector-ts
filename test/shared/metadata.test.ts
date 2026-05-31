import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const PAGE_CONTENT_KEY = '_page_content';

describe('buildPutMetadata', () => {
  it('stores pageContent under the key when key is set', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, PAGE_CONTENT_KEY)).toEqual({
      genre: 'scifi',
      [PAGE_CONTENT_KEY]: 'hello',
    });
  });

  it('omits pageContent when key is null', () => {
    const doc = new Document({ pageContent: 'hello', metadata: { genre: 'scifi' } });
    expect(buildPutMetadata(doc, null)).toEqual({ genre: 'scifi' });
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
