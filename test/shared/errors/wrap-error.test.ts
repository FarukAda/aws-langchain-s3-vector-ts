import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';
import { toError, wrapAwsError } from '../../../src/shared/errors/wrap-error.js';

describe('toError', () => {
  it('returns Error values unchanged', () => {
    const e = new Error('x');
    expect(toError(e)).toBe(e);
  });

  it('wraps a string into an Error', () => {
    expect(toError('string failure').message).toBe('string failure');
  });

  it('serializes a non-string, non-Error value', () => {
    expect(toError({ reason: 'nope' }).message).toBe('{"reason":"nope"}');
  });

  it('treats null as a non-Error, safely stringified', () => {
    expect(toError(null).message).toBe('null');
  });

  it('does not treat a message-only object (no name) as an Error', () => {
    expect(toError({ message: 'boom' }).message).toBe('{"message":"boom"}');
  });

  it('does not treat a name-only object (no message) as an Error', () => {
    expect(toError({ name: 'Foo' }).message).toBe('{"name":"Foo"}');
  });

  it('treats a plain {name, message} object as already-an-Error', () => {
    const looksLikeError = { name: 'Foo', message: 'bar' };
    expect(toError(looksLikeError)).toBe(looksLikeError);
  });

  it('recognizes a DOMException as an Error despite its own Symbol.toStringTag', () => {
    const domException = new DOMException('The operation was aborted.', 'AbortError');
    expect(toError(domException)).toBe(domException);
    expect(toError(domException).message).toBe('The operation was aborted.');
  });

  it('stringifies a thrown undefined instead of losing it to JSON.stringify returning undefined', () => {
    expect(toError(undefined).message).toBe('undefined');
  });
});

describe('toError safety', () => {
  it('does not throw on a circular-reference object', () => {
    const circular: Record<string, unknown> = { message: 'boom' };
    circular['self'] = circular;
    expect(() => toError(circular)).not.toThrow();
    expect(toError(circular)).toBeInstanceOf(Error);
  });

  it('does not throw on a value containing a BigInt', () => {
    const value = { big: 10n };
    expect(() => toError(value)).not.toThrow();
    expect(toError(value)).toBeInstanceOf(Error);
  });
});

describe('wrapAwsError', () => {
  it('wraps an unknown cause into a coded S3VectorsError', () => {
    const cause = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'PutVectors',
    });
    expect(isS3VectorsError(err)).toBe(true);
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.message).toBe('PutVectors failed (AccessDeniedException): denied');
    expect(err.cause).toBe(cause);
    expect(err.context.awsErrorName).toBe('AccessDeniedException');
    expect(err.context.retryable).toBe(false);
  });

  it('lifts httpStatusCode and requestId off $metadata into context and the message', () => {
    const cause = Object.assign(new Error('slow down'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429, requestId: 'REQ-123', attempts: 3 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'QueryVectors',
    });
    expect(err.message).toBe(
      'QueryVectors failed (ThrottlingException, HTTP 429, requestId REQ-123): slow down',
    );
    expect(err.context).toMatchObject({
      operation: 'QueryVectors',
      awsErrorName: 'ThrottlingException',
      httpStatusCode: 429,
      requestId: 'REQ-123',
      retryable: true,
    });
  });

  it.each([
    ['ThrottlingException', 400],
    ['TooManyRequestsException', 429],
    ['ServiceUnavailableException', 503],
    ['InternalServerException', 500],
    ['SomeOtherException', 502],
  ])('marks %s (HTTP %i) as retryable', (name, httpStatusCode) => {
    const cause = Object.assign(new Error('x'), { name, $metadata: { httpStatusCode } });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.retryable).toBe(true);
  });

  it('honours the SDK own $retryable marker even for an unrecognised name and status', () => {
    const cause = Object.assign(new Error('x'), {
      name: 'WeirdException',
      $metadata: { httpStatusCode: 400 },
      $retryable: { throttling: true },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.retryable).toBe(true);
  });

  it('marks a 4xx client error as not retryable', () => {
    const cause = Object.assign(new Error('bad'), {
      name: 'ValidationException',
      $metadata: { httpStatusCode: 400 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.retryable).toBe(false);
    expect(err.context.httpStatusCode).toBe(400);
  });

  it('accepts a $metadata-only cause with no usable name (name "Error" is still reported)', () => {
    const cause = Object.assign(new Error('x'), { $metadata: {} });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.awsErrorName).toBe('Error');
    expect(err.context.httpStatusCode).toBeUndefined();
    expect(err.context.requestId).toBeUndefined();
    expect(err.context.retryable).toBe(false);
  });

  it('tolerates a $metadata-bearing cause whose name is not a string', () => {
    const cause = { name: 5, message: 'odd', $metadata: { httpStatusCode: 500 } };
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.httpStatusCode).toBe(500);
    expect(err.context.retryable).toBe(true);
    expect(err.message).toBe(
      'op failed (HTTP 500): {"name":5,"message":"odd","$metadata":{"httpStatusCode":500}}',
    );
  });

  it('ignores malformed $metadata fields instead of copying them through', () => {
    const cause = Object.assign(new Error('x'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: '403', requestId: 42 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'op' });
    expect(err.context.httpStatusCode).toBeUndefined();
    expect(err.context.requestId).toBeUndefined();
    expect(err.message).toBe('op failed (AccessDeniedException): x');
  });

  it('presents a non-AWS cause (a TypeError, a string, null) without any AWS diagnostics', () => {
    for (const cause of [new TypeError('nope'), 'boom', null, { name: 'Error', message: 'm' }]) {
      const err = wrapAwsError(cause, S3VectorsErrorCode.UNEXPECTED_ERROR, { operation: 'op' });
      expect(err.message.startsWith('op failed: ')).toBe(true);
      expect(err.context.awsErrorName).toBeUndefined();
      expect(err.context.retryable).toBeUndefined();
    }
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a number', 42],
  ])('survives an AWS-shaped error whose $metadata is %s', (_label, metadata) => {
    // A caller-supplied client with its own request handler can produce this.
    // Reading through it unguarded would throw a TypeError from inside error
    // handling, replacing the real failure with a worse one.
    const cause = Object.assign(new Error('boom'), {
      name: 'ValidationException',
      $metadata: metadata,
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REJECTED, { operation: 'op' });
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REJECTED);
    expect(err.context.awsErrorName).toBe('ValidationException');
    expect(err.context.httpStatusCode).toBeUndefined();
    expect(err.context.requestId).toBeUndefined();
  });

  it('does not dress a non-AWS error up as one because it carries a junk $metadata', () => {
    // `name` does not end in 'Exception' and `$metadata` is not the SDK's
    // shape, so there is nothing here that came from AWS. Reporting
    // `awsErrorName: 'TypeError'` and a retryability verdict would invite a
    // caller to retry a bug in their own code.
    const cause = Object.assign(new Error('x'), { name: 'TypeError', $metadata: 'nope' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.UNEXPECTED_ERROR, { operation: 'op' });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.retryable).toBeUndefined();
  });

  it('reads the diagnostics when $metadata is the shape the SDK documents', () => {
    const cause = Object.assign(new Error('boom'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429, requestId: 'r-9' },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.THROTTLED, { operation: 'op' });
    expect(err.context).toMatchObject({
      awsErrorName: 'ThrottlingException',
      httpStatusCode: 429,
      requestId: 'r-9',
      retryable: true,
    });
  });

  it('returns an already-S3VectorsError unchanged', () => {
    const original = new S3VectorsError('v', S3VectorsErrorCode.VALIDATION, { operation: 'x' });
    expect(wrapAwsError(original, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'y' })).toBe(
      original,
    );
  });
});
