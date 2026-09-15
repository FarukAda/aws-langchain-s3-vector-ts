import { describe, it, expect } from '@jest/globals';

import { isStubEmbeddings, StubEmbeddings } from '../../src/shared/stub-embeddings.js';

describe('the stub brand', () => {
  it('recognises a stub from a second copy of this module', () => {
    // A store built by the ESM copy may be inspected by the CommonJS one. If
    // the brand were not a registered symbol, that store would look as though
    // it had a real embedding model and the EMBEDDINGS_MISSING guard would
    // never fire.
    const fromTheOtherCopy = {
      [Symbol.for('@farukada/aws-langchain-s3-vector-ts:StubEmbeddings')]: true,
    };
    expect(isStubEmbeddings(fromTheOtherCopy)).toBe(true);
  });

  it('does not mistake a real embeddings model for the stub', () => {
    expect(
      isStubEmbeddings({ embedQuery: async () => [1], embedDocuments: async () => [[1]] }),
    ).toBe(false);
  });
});

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
