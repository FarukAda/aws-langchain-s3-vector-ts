import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from '../helpers.js';

describe('maxMarginalRelevanceSearch (parity: not implemented)', () => {
  it('throws/rejects with a not-implemented error', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    await expect((async () => store.maxMarginalRelevanceSearch('q', { k: 2 }))()).rejects.toThrow();
  });
});
