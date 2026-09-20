import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
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
      'was built with no embeddings model',
    );
  });

  it('rejects embedQuery with a clear error', async () => {
    await expect(new StubEmbeddings().embedQuery('x')).rejects.toThrow(
      'was built with no embeddings model',
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

describe('what the stub throws when a consumer reaches it directly', () => {
  // The store guards every internal use, so nothing in this package calls
  // these. What can is a generic `@langchain/core` consumer: `store.embeddings`
  // is typed as a live `EmbeddingsInterface` on the base class, so
  // `store.embeddings.embedQuery(q)` compiles and is a reasonable thing for
  // framework code to do. It reached a raw Error, which `isS3VectorsError`
  // reports false for — the one path where "every failure this package raises
  // is coded" was untrue.
  it('raises a coded EMBEDDINGS_MISSING from embedQuery', async () => {
    const error = await new StubEmbeddings().embedQuery('q').catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
  });

  it('raises a coded EMBEDDINGS_MISSING from embedDocuments', async () => {
    const error = await new StubEmbeddings().embedDocuments(['a']).catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
  });

  it('names the option to set, as the store’s own refusal does', async () => {
    const error = await new StubEmbeddings().embedQuery('q').catch((e: unknown) => e);
    expect((error as Error).message).toContain('embeddings');
  });
});
