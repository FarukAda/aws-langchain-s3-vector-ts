import { describe, it, expect } from '@jest/globals';

import { isStubEmbeddings, StubEmbeddings } from '../../src/shared/stub-embeddings.js';

describe('StubEmbeddings', () => {
  it('rejects embedDocuments with a clear error', async () => {
    await expect(new StubEmbeddings().embedDocuments(['x'])).rejects.toThrow(
      'No embedding model configured',
    );
  });

  it('rejects embedQuery with a clear error', async () => {
    await expect(new StubEmbeddings().embedQuery('x')).rejects.toThrow(
      'No embedding model configured',
    );
  });
});

describe('isStubEmbeddings', () => {
  it('is true for a StubEmbeddings instance', () => {
    expect(isStubEmbeddings(new StubEmbeddings())).toBe(true);
  });

  it('is false for real embeddings and non-objects', () => {
    expect(isStubEmbeddings({ embedDocuments: async () => [], embedQuery: async () => [] })).toBe(
      false,
    );
    expect(isStubEmbeddings(null)).toBe(false);
    expect(isStubEmbeddings('stub')).toBe(false);
  });
});
