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
    expect(err.message).toBe('PutVectors failed: denied');
    expect(err.cause).toBe(cause);
  });

  it('returns an already-S3VectorsError unchanged', () => {
    const original = new S3VectorsError('v', S3VectorsErrorCode.VALIDATION, { operation: 'x' });
    expect(wrapAwsError(original, S3VectorsErrorCode.AWS_REQUEST_FAILED, { operation: 'y' })).toBe(
      original,
    );
  });
});
