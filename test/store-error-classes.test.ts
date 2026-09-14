import { GetIndexCommand, PutVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore, indexFixture } from './helpers.js';

/**
 * Service failures reach the caller as the class they belong to, not as one
 * generic code (DESIGN.md D-16). A caller branches on retry-now, retry-later,
 * fix-IAM, fix-KMS, fix-request and missing-resource.
 */
const awsError = (name: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(`synthetic ${name}`), { name, ...extra });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;
const doc = (t: string): Document => new Document({ pageContent: t });

const writeFailingWith = async (error: Error): Promise<unknown> => {
  const { store, mock } = createTestStore();
  mock.on(GetIndexCommand).resolves({ index: indexFixture() });
  mock.on(PutVectorsCommand).rejects(error);
  return store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] }).catch((e: unknown) => e);
};

describe('store — AWS failures carry their class', () => {
  it.each([
    ['TooManyRequestsException', S3VectorsErrorCode.THROTTLED],
    ['ServiceUnavailableException', S3VectorsErrorCode.SERVICE_UNAVAILABLE],
    ['InternalServerException', S3VectorsErrorCode.SERVICE_UNAVAILABLE],
    ['RequestTimeoutException', S3VectorsErrorCode.SERVICE_UNAVAILABLE],
    ['ServiceQuotaExceededException', S3VectorsErrorCode.QUOTA_EXCEEDED],
    ['AccessDeniedException', S3VectorsErrorCode.ACCESS_DENIED],
    ['ValidationException', S3VectorsErrorCode.AWS_REJECTED],
    ['KmsDisabledException', S3VectorsErrorCode.KMS_ERROR],
    ['KmsNotFoundException', S3VectorsErrorCode.KMS_ERROR],
  ])('maps a %s from PutVectors to %s', async (name, expected) => {
    expect(codeOf(await writeFailingWith(awsError(name)))).toBe(expected);
  });

  it('keeps an unrecognised exception on the catch-all, so a new AWS error cannot break the model', async () => {
    expect(codeOf(await writeFailingWith(awsError('SomeFutureException')))).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
  });

  it('distinguishes a throttle from a server fault, which callers act on differently', async () => {
    const throttled = codeOf(await writeFailingWith(awsError('TooManyRequestsException')));
    const faulted = codeOf(await writeFailingWith(awsError('InternalServerException')));
    expect(throttled).not.toBe(faulted);
  });

  it('surfaces the rejected field from a ValidationException, not just that one failed', async () => {
    const error = await writeFailingWith(
      awsError('ValidationException', {
        fieldList: [{ path: 'vectors[0].metadata', message: 'too large' }],
      }),
    );
    const context = (error as { context: Record<string, unknown> }).context;
    expect(context['fieldList']).toEqual([{ path: 'vectors[0].metadata', message: 'too large' }]);
  });

  it('classifies a search failure the same way', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).rejects(awsError('AccessDeniedException'));
    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 1)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('still reports an abort as ABORTED rather than as a service failure', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).rejects(awsError('AbortError'));
    const error = await store
      .addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
  });
});
