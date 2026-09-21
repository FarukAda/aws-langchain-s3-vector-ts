import { describe, it, expect } from '@jest/globals';

import {
  classifyAwsError,
  isTransientNetworkFailure,
} from '../../../src/shared/errors/classify.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of `classifyAwsError`. Each expectation traces to a
 * clause of that contract; the exception names come from
 * `@aws-sdk/client-s3vectors@3.1136.0` `dist-types/models/errors.d.ts`, where
 * every class declares `name` as a literal type.
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

  // A `name` that cannot become a property key. Looking it up in a table
  // coerces it first, and the coercion itself throws — from inside every AWS
  // `catch`, where it replaced the failure being reported with a TypeError
  // about describing it.
  it.each([
    ['an object with no prototype', Object.create(null) as unknown],
    [
      'an object whose toString throws',
      {
        toString: (): string => {
          throw new Error('no');
        },
      },
    ],
  ])('maps a name that is %s to AWS_REQUEST_FAILED rather than throwing', (_label, name) => {
    expect(classifyAwsError({ name, message: 'x' })).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('does not confuse a throttle with a server fault: they are different codes', () => {
    expect(classifyAwsError(named('TooManyRequestsException'))).not.toBe(
      classifyAwsError(named('InternalServerException')),
    );
  });

  it("maps the SDK's own TimeoutError to SERVICE_UNAVAILABLE, the class its retry strategy puts it in", () => {
    expect(classifyAwsError(named('TimeoutError'))).toBe(S3VectorsErrorCode.SERVICE_UNAVAILABLE);
  });

  it.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
  ])(
    'maps a plain Error carrying code %s to SERVICE_UNAVAILABLE, the class the SDK retry strategy puts it in',
    (code) => {
      // `@smithy/node-http-handler` renames only ECONNRESET, EPIPE and ETIMEDOUT
      // to TimeoutError; the other five, including ECONNREFUSED, reach here
      // keeping their own name and carrying only `code`.
      const error = Object.assign(new Error(`synthetic ${code}`), { code });
      expect(error.name).toBe('Error');
      expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.SERVICE_UNAVAILABLE);
    },
  );

  it('maps a code outside the SDK retry strategy set (EACCES) to AWS_REQUEST_FAILED', () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('maps a non-string code to AWS_REQUEST_FAILED, so the string check cannot throw', () => {
    const error = Object.assign(new Error('odd'), { code: 42 });
    expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('maps an AbortError carrying a transient network code to ABORTED, because the caller cancelled', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ECONNRESET' });
    expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.ABORTED);
  });

  it('keeps a declared service exception name even when it carries a transient network code', () => {
    const error = Object.assign(new Error('denied'), {
      name: 'AccessDeniedException',
      code: 'ECONNREFUSED',
    });
    expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });
});

/**
 * `isTransientNetworkFailure` is the one place the precedence for the
 * network-code rule is decided — `classifyAwsError`'s final branch, and
 * `wrap-error.ts`'s `isRetryable`/`awsDiagnostics`, all call it rather than
 * re-deriving any of it. Its own callers never pass it a non-object (both
 * guard before calling), so that branch is only reachable by calling it
 * directly, which is what makes it worth testing as its own unit rather than
 * only through `classifyAwsError`.
 */
describe('isTransientNetworkFailure', () => {
  it.each([[null], [undefined], ['ECONNREFUSED'], [42]])(
    'is false for a non-object value (%p), so it stays total',
    (value) => {
      expect(isTransientNetworkFailure(value)).toBe(false);
    },
  );

  it('is false for an abort, even one carrying a transient network code', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ECONNRESET' });
    expect(isTransientNetworkFailure(error)).toBe(false);
  });

  it("is false for the SDK's own TimeoutError name", () => {
    const error = Object.assign(new Error('socket hang up'), {
      name: 'TimeoutError',
      code: 'ECONNRESET',
    });
    expect(isTransientNetworkFailure(error)).toBe(false);
  });

  it('is false for a declared service exception name, even one carrying a transient network code', () => {
    const error = Object.assign(new Error('denied'), {
      name: 'AccessDeniedException',
      code: 'ECONNREFUSED',
    });
    expect(isTransientNetworkFailure(error)).toBe(false);
  });

  it('reads the code of an error whose name cannot become a property key, rather than throwing', () => {
    const error = { name: Object.create(null) as unknown, code: 'ECONNREFUSED' };
    expect(isTransientNetworkFailure(error)).toBe(true);
  });
});
