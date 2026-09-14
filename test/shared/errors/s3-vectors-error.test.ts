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

  it('recognises an error from a second copy of this module', () => {
    // A process that mixes `import` and `require` loads the ESM and the
    // CommonJS build, each with its own class — `instanceof` is false across
    // them. The brand is a registered symbol, so it is the same symbol in
    // both, which is what this stands in for.
    const fromTheOtherCopy = Object.assign(new Error('x'), {
      [Symbol.for('@farukada/aws-langchain-s3-vector-ts:S3VectorsError')]: true,
    });
    expect(isS3VectorsError(fromTheOtherCopy)).toBe(true);
  });

  it('is not fooled by an error that merely claims the name', () => {
    expect(isS3VectorsError(Object.assign(new Error('x'), { name: 'S3VectorsError' }))).toBe(false);
  });
});

describe('S3VectorsErrorCode — the value is the contract, not the key', () => {
  it('every member serialises to its own name', () => {
    // A caller who cannot import the enum compares against the string, and
    // docs/STABILITY.md promises a value is never renamed. A key and value
    // that drift apart break that silently.
    for (const [key, value] of Object.entries(S3VectorsErrorCode)) {
      expect(value).toBe(key);
    }
  });

  it('holds exactly the codes the documentation lists', () => {
    expect(Object.keys(S3VectorsErrorCode).sort()).toEqual([
      'ABORTED',
      'ACCESS_DENIED',
      'AWS_INVALID_RESPONSE',
      'AWS_REJECTED',
      'AWS_REQUEST_FAILED',
      'CONFLICT',
      'EMBEDDINGS_MISSING',
      'INDEX_CONFIG_MISMATCH',
      'KMS_ERROR',
      'NOT_FOUND',
      'QUERY_PAGE_LIMIT_EXCEEDED',
      'QUOTA_EXCEEDED',
      'SERVICE_UNAVAILABLE',
      'THROTTLED',
      'UNEXPECTED_ERROR',
      'VALIDATION',
    ]);
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

    // The instance is the store the write was attempted against, not merely
    // something truthy: a caller recovers by calling delete/getByIds on it.
    expect(error.context.instance).toBeInstanceOf(AmazonS3Vectors);
    expect(error.context.instance?.indexName).toBe(BASE_CONFIG.indexName);

    const serialized = JSON.stringify(error.context.instance);
    expect(serialized).not.toContain('_client');
    expect(serialized).not.toContain('credentials');
    expect(serialized).not.toContain('accessKeyId');
    expect(JSON.parse(serialized)).toMatchObject({ type: 'not_implemented' });
  });
});
