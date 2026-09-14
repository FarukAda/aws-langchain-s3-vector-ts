import { describe, it, expect } from '@jest/globals';

import { classifyAwsError } from '../../../src/shared/errors/classify.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of `classifyAwsError` (docs/CONTRACTS-DRAFT.md,
 * "Error model"). Each expectation traces to a clause of that contract; the
 * exception names come from `@aws-sdk/client-s3vectors@3.1118.0`
 * `dist-types/models/errors.d.ts`, where every class declares `name` as a
 * literal type.
 */
const named = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });

describe('classifyAwsError', () => {
  it('maps an abort to ABORTED, because the caller cancelled and nothing failed', () => {
    expect(classifyAwsError(named('AbortError'))).toBe(S3VectorsErrorCode.ABORTED);
  });

  it('maps TooManyRequestsException to THROTTLED', () => {
    expect(classifyAwsError(named('TooManyRequestsException'))).toBe(S3VectorsErrorCode.THROTTLED);
  });

  it.each(['InternalServerException', 'RequestTimeoutException', 'ServiceUnavailableException'])(
    'maps %s to SERVICE_UNAVAILABLE',
    (name) => {
      expect(classifyAwsError(named(name))).toBe(S3VectorsErrorCode.SERVICE_UNAVAILABLE);
    },
  );

  it('maps ServiceQuotaExceededException to QUOTA_EXCEEDED, not to a retryable class', () => {
    expect(classifyAwsError(named('ServiceQuotaExceededException'))).toBe(
      S3VectorsErrorCode.QUOTA_EXCEEDED,
    );
  });

  it('maps AccessDeniedException to ACCESS_DENIED', () => {
    expect(classifyAwsError(named('AccessDeniedException'))).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('maps ConflictException to CONFLICT', () => {
    expect(classifyAwsError(named('ConflictException'))).toBe(S3VectorsErrorCode.CONFLICT);
  });

  it('maps NotFoundException to NOT_FOUND', () => {
    expect(classifyAwsError(named('NotFoundException'))).toBe(S3VectorsErrorCode.NOT_FOUND);
  });

  it('maps ValidationException to AWS_REJECTED', () => {
    expect(classifyAwsError(named('ValidationException'))).toBe(S3VectorsErrorCode.AWS_REJECTED);
  });

  it.each([
    'KmsDisabledException',
    'KmsInvalidKeyUsageException',
    'KmsInvalidStateException',
    'KmsNotFoundException',
  ])('maps %s to KMS_ERROR', (name) => {
    expect(classifyAwsError(named(name))).toBe(S3VectorsErrorCode.KMS_ERROR);
  });

  it('maps an unrecognised exception name to AWS_REQUEST_FAILED, so a new AWS exception cannot break the model', () => {
    expect(classifyAwsError(named('SomeFutureException'))).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
  });

  it.each([['a string'], [null], [undefined], [42]])(
    'maps a non-exception value (%p) to AWS_REQUEST_FAILED, so the function is total',
    (value) => {
      expect(classifyAwsError(value)).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    },
  );

  it('maps an object whose name is not a string to AWS_REQUEST_FAILED', () => {
    expect(classifyAwsError({ name: 42 })).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('maps an object with no name at all to AWS_REQUEST_FAILED', () => {
    expect(classifyAwsError({})).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('does not confuse a throttle with a server fault: they are different codes', () => {
    expect(classifyAwsError(named('TooManyRequestsException'))).not.toBe(
      classifyAwsError(named('InternalServerException')),
    );
  });
});
