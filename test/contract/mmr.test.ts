import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from '../helpers.js';

describe('maxMarginalRelevanceSearch (parity: not implemented)', () => {
  it('rejects with a coded S3VectorsError (NOT_IMPLEMENTED), not a raw TypeError', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const error = await store.maxMarginalRelevanceSearch('q', { k: 2 }).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.NOT_IMPLEMENTED);
  });
});
