import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';
import { toError, wrapAwsError, wrapCallerError } from '../../../src/shared/errors/wrap-error.js';

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
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'addVectors',
    });
    expect(isS3VectorsError(err)).toBe(true);
    expect(err.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(err.message).toBe('addVectors failed on PutVectors (AccessDeniedException): denied');
    expect(err.cause).toBe(cause);
    expect(err.context.awsErrorName).toBe('AccessDeniedException');
    expect(err.context.retryable).toBe(false);
  });

  it('records the public method as the operation and the request as awsCommand', () => {
    const cause = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.ACCESS_DENIED, 'DeleteVectors', {
      operation: 'delete',
      vectorBucketName: 'b',
      indexName: 'i',
    });
    expect(err.context.operation).toBe('delete');
    expect(err.context.awsCommand).toBe('DeleteVectors');
  });

  it('names the request even when the cause carries nothing AWS-shaped', () => {
    // A request failed either way: the command is known from the call site,
    // not read off the cause.
    const err = wrapAwsError('a thrown string', S3VectorsErrorCode.AWS_REQUEST_FAILED, 'GetIndex', {
      operation: 'addDocuments',
    });
    expect(err.context.awsCommand).toBe('GetIndex');
    expect(err.message).toBe('addDocuments failed on GetIndex: a thrown string');
  });

  it('lifts httpStatusCode and requestId off $metadata into context and the message', () => {
    const cause = Object.assign(new Error('slow down'), {
      name: 'TooManyRequestsException',
      $metadata: { httpStatusCode: 429, requestId: 'REQ-123', attempts: 3 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'QueryVectors', {
      operation: 'similaritySearch',
    });
    expect(err.message).toBe(
      'similaritySearch failed on QueryVectors (TooManyRequestsException, HTTP 429, requestId REQ-123): slow down',
    );
    expect(err.context).toMatchObject({
      operation: 'similaritySearch',
      awsCommand: 'QueryVectors',
      awsErrorName: 'TooManyRequestsException',
      httpStatusCode: 429,
      requestId: 'REQ-123',
      retryable: true,
    });
  });

  it.each([
    ['RequestTimeoutException', 408],
    ['TooManyRequestsException', 429],
    ['ServiceUnavailableException', 503],
    ['InternalServerException', 500],
    ['SomeOtherException', 502],
  ])('marks %s (HTTP %i) as retryable', (name, httpStatusCode) => {
    const cause = Object.assign(new Error('x'), { name, $metadata: { httpStatusCode } });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(true);
  });

  it('honours the SDK own $retryable marker even for an unrecognised name and status', () => {
    const cause = Object.assign(new Error('x'), {
      name: 'WeirdException',
      $metadata: { httpStatusCode: 400 },
      $retryable: { throttling: true },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(true);
  });

  it('marks a 4xx client error as not retryable', () => {
    const cause = Object.assign(new Error('bad'), {
      name: 'ValidationException',
      $metadata: { httpStatusCode: 400 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(false);
    expect(err.context.httpStatusCode).toBe(400);
  });

  it('accepts a $metadata-only cause with no usable name (name "Error" is still reported)', () => {
    const cause = Object.assign(new Error('x'), { $metadata: {} });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.awsErrorName).toBe('Error');
    expect(err.context.httpStatusCode).toBeUndefined();
    expect(err.context.requestId).toBeUndefined();
    expect(err.context.retryable).toBe(false);
  });

  it('tolerates a $metadata-bearing cause whose name is not a string', () => {
    const cause = { name: 5, message: 'odd', $metadata: { httpStatusCode: 500 } };
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.httpStatusCode).toBe(500);
    expect(err.context.retryable).toBe(true);
    expect(err.message).toBe(
      'op failed on PutVectors (HTTP 500): {"name":5,"message":"odd","$metadata":{"httpStatusCode":500}}',
    );
  });

  it('ignores malformed $metadata fields instead of copying them through', () => {
    const cause = Object.assign(new Error('x'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: '403', requestId: 42 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.httpStatusCode).toBeUndefined();
    expect(err.context.requestId).toBeUndefined();
    expect(err.message).toBe('op failed on PutVectors (AccessDeniedException): x');
  });

  it('presents a non-AWS cause (a TypeError, a string, null) without any AWS diagnostics', () => {
    for (const cause of [new TypeError('nope'), 'boom', null, { name: 'Error', message: 'm' }]) {
      const err = wrapAwsError(cause, S3VectorsErrorCode.UNEXPECTED_ERROR, 'PutVectors', {
        operation: 'op',
      });
      expect(err.message.startsWith('op failed on PutVectors: ')).toBe(true);
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
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REJECTED, 'PutVectors', {
      operation: 'op',
    });
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
    const err = wrapAwsError(cause, S3VectorsErrorCode.UNEXPECTED_ERROR, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.retryable).toBeUndefined();
  });

  it('reads the diagnostics when $metadata is the shape the SDK documents', () => {
    const cause = Object.assign(new Error('boom'), {
      name: 'TooManyRequestsException',
      $metadata: { httpStatusCode: 429, requestId: 'r-9' },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.THROTTLED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context).toMatchObject({
      awsErrorName: 'TooManyRequestsException',
      httpStatusCode: 429,
      requestId: 'r-9',
      retryable: true,
    });
  });

  it.each([
    'TooManyRequestsException',
    'ServiceUnavailableException',
    'InternalServerException',
    'RequestTimeoutException',
    // Not a service exception: the SDK's HTTP handler raises it on a connection,
    // socket-idle or request timeout, and this package applies a socket timeout
    // by default — so it is a failure callers actually see.
    'TimeoutError',
  ])('marks %s retryable, so a caller-side backoff can act on it', (name) => {
    const cause = Object.assign(new Error('x'), { name, $metadata: {} });
    const err = wrapAwsError(cause, S3VectorsErrorCode.SERVICE_UNAVAILABLE, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(true);
  });

  it.each(['ThrottlingException', 'InternalServerError', 'RequestTimeout'])(
    'does not claim %s is retryable, because S3 Vectors never sends it',
    (name) => {
      // These three were in the retryable set and in the `retryable` field
      // documentation, and S3 Vectors declares none of them. A caller branching
      // on the prose would have written a branch that never runs. Kept as a
      // test so the names cannot drift back in.
      const cause = Object.assign(new Error('x'), { name, $metadata: {} });
      const err = wrapAwsError(cause, S3VectorsErrorCode.SERVICE_UNAVAILABLE, 'PutVectors', {
        operation: 'op',
      });
      expect(err.context.retryable).toBe(false);
    },
  );

  it.each(['ValidationException', 'AccessDeniedException', 'ConflictException'])(
    'leaves %s not retryable, because backoff cannot fix it',
    (name) => {
      const cause = Object.assign(new Error('x'), { name, $metadata: { httpStatusCode: 400 } });
      const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REJECTED, 'PutVectors', {
        operation: 'op',
      });
      expect(err.context.retryable).toBe(false);
    },
  );

  it('marks a refused connection retryable even with no $metadata at all', () => {
    // The SDK's own retry strategy matches this by `code`, not by `name` — the
    // error keeps its own name, so `metadata === undefined` alone would
    // otherwise drop it out with no diagnostics at all.
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.SERVICE_UNAVAILABLE, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(true);
    expect(err.context.awsErrorName).toBe('Error');
  });

  it('marks a refused connection retryable when it does carry $metadata', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      $metadata: {},
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.SERVICE_UNAVAILABLE, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBe(true);
  });

  it('gives a code outside the SDK retry strategy set (EACCES) no AWS diagnostics, with no $metadata either', () => {
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.retryable).toBeUndefined();
    expect(err.context.awsErrorName).toBeUndefined();
  });

  it('gives the classification precedence to a declared exception name over a network code it happens to carry', () => {
    // A service error that happens to wrap a network `code` (a proxy in front
    // of the AWS endpoint refusing the connection, say) stays whatever its own
    // name says it is — not retryable, because `AccessDeniedException` is an
    // IAM problem backoff cannot fix, regardless of `code`.
    const cause = Object.assign(new Error('denied'), {
      name: 'AccessDeniedException',
      code: 'ECONNREFUSED',
      $metadata: { httpStatusCode: 403 },
    });
    const err = wrapAwsError(cause, S3VectorsErrorCode.ACCESS_DENIED, 'PutVectors', {
      operation: 'op',
    });
    expect(err.context.awsErrorName).toBe('AccessDeniedException');
    expect(err.context.httpStatusCode).toBe(403);
    expect(err.context.retryable).toBe(false);
  });

  it('never lets an abort pick up AWS diagnostics through a network code it happens to carry', () => {
    // The caller cancelled; nothing failed. An `AbortError` is not
    // AWS-shaped by any other means either (no `$metadata`, no `…Exception`
    // name), so this gets no diagnostics at all — not `retryable: false`,
    // which would still claim an opinion about a request that never failed.
    const cause = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ECONNRESET' });
    const err = wrapAwsError(cause, S3VectorsErrorCode.ABORTED, 'PutVectors', { operation: 'op' });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.retryable).toBeUndefined();
    // Still the request that was cancelled in flight.
    expect(err.context.awsCommand).toBe('PutVectors');
  });

  it('returns an already-S3VectorsError unchanged', () => {
    const original = new S3VectorsError('v', S3VectorsErrorCode.VALIDATION, { operation: 'x' });
    expect(
      wrapAwsError(original, S3VectorsErrorCode.AWS_REQUEST_FAILED, 'PutVectors', {
        operation: 'y',
      }),
    ).toBe(original);
  });
});

describe('wrapCallerError', () => {
  it('always classifies as UNEXPECTED_ERROR, regardless of what the cause looks like', () => {
    const err = wrapCallerError(new Error('model blew up'), { operation: 'op' });
    expect(err.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(err.message).toBe('op failed: model blew up');
    // Caller code is not an AWS request, so no request is named.
    expect(err.context).not.toHaveProperty('awsCommand');
  });

  it('returns an already-S3VectorsError unchanged, e.g. an EMBEDDINGS_MISSING raised by a model lookup', () => {
    const original = new S3VectorsError('no model', S3VectorsErrorCode.EMBEDDINGS_MISSING, {
      operation: 'x',
    });
    expect(wrapCallerError(original, { operation: 'y' })).toBe(original);
  });

  it('never applies the network-code rule: a bare refused connection gets no AWS diagnostics', () => {
    // Caller code — an embeddings provider's own HTTP client, say — can raise
    // the exact same Node.js system error codes over a connection that has
    // nothing to do with AWS. Reporting `awsErrorName`/`retryable` for that
    // would send a caller retrying against the wrong service.
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const err = wrapCallerError(cause, { operation: 'op' });
    expect(err.context.awsErrorName).toBeUndefined();
    expect(err.context.retryable).toBeUndefined();
  });

  it('still recognises $metadata and a declared …Exception name, for an AWS-SDK-based model', () => {
    const cause = Object.assign(new Error('throttled'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    const err = wrapCallerError(cause, { operation: 'op' });
    expect(err.context.awsErrorName).toBe('ThrottlingException');
    expect(err.context.retryable).toBe(true);
  });

  it("still recognises the SDK's own TimeoutError name", () => {
    const cause = Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
    const err = wrapCallerError(cause, { operation: 'op' });
    expect(err.context.awsErrorName).toBe('TimeoutError');
    expect(err.context.retryable).toBe(true);
  });
});
