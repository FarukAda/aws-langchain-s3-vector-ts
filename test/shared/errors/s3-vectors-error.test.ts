import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from '../../helpers.js';

describe('S3VectorsError', () => {
  it('carries code, context, and cause', () => {
    const cause = new Error('boom');
    const err = new S3VectorsError(
      'failed',
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
      { operation: 'PutVectors', indexName: 'idx' },
      cause,
    );

    expect(err.message).toBe('failed');
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.context.operation).toBe('PutVectors');
    expect(err.context.indexName).toBe('idx');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('S3VectorsError');
  });

  it('omits cause when none is provided', () => {
    const err = new S3VectorsError('x', S3VectorsErrorCode.VALIDATION, { operation: 'ctor' });
    expect(err.cause).toBeUndefined();
  });

  it('is identified by the guard without instanceof', () => {
    const err = new S3VectorsError('x', S3VectorsErrorCode.VALIDATION, { operation: 'ctor' });
    expect(isS3VectorsError(err)).toBe(true);
    expect(isS3VectorsError(new Error('x'))).toBe(false);
    expect(isS3VectorsError(null)).toBe(false);
    expect(isS3VectorsError('S3VectorsError')).toBe(false);
  });
});

describe('S3VectorsErrorContext.instance — serialization safety', () => {
  // context.instance is a live store handle carrying `_client`, and that
  // client carries credentials. It is safe to JSON.stringify only because
  // Serializable#toJSON() short-circuits while lc_serializable is false.
  // AmazonS3Vectors pins that flag rather than inheriting it; this test is
  // what makes an upstream default change fail CI instead of silently
  // leaking credentials into structured logs.
  it('never serializes client internals through context.instance', async () => {
    const { client, mock } = createMockClient();
    mock
      .on(GetIndexCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    const error = (await AmazonS3Vectors.fromDocuments(
      [new Document({ pageContent: 'a' })],
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e)) as S3VectorsError;

    expect(error.context.instance).toBeDefined();

    const serialized = JSON.stringify(error.context.instance);
    expect(serialized).not.toContain('_client');
    expect(serialized).not.toContain('credentials');
    expect(serialized).not.toContain('accessKeyId');
    expect(JSON.parse(serialized)).toMatchObject({ type: 'not_implemented' });
  });
});
