import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

describe('AmazonS3Vectors error surface', () => {
  it('wraps AWS failures as S3VectorsError with operation context', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: {} });
    mock
      .on(PutVectorsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    try {
      await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });
      throw new Error('should have thrown');
    } catch (error: unknown) {
      expect(isS3VectorsError(error)).toBe(true);
      const typed = error as { code: S3VectorsErrorCode; context: { operation: string } };
      expect(typed.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
      expect(typed.context.operation).toBe('PutVectors');
    }
  });
});
