import { describe, it, expect } from '@jest/globals';

import {
  attachInstance,
  attachOperation,
  attachPartialIds,
} from '../../../src/shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';

/**
 * One test per domain cell of the error decorators. Two jobs: never lose track
 * of what already committed, and never become the apparent origin of a failure
 * they only annotate.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const coded = (): S3VectorsError =>
  new S3VectorsError('original failed', S3VectorsErrorCode.THROTTLED, {
    operation: 'addVectors',
    ...SCOPE,
    requestId: 'r-1',
  });

describe('attachPartialIds', () => {
  it('keeps the original class and cause rather than flattening them', () => {
    const cause = new Error('underlying');
    const base = new S3VectorsError(
      'failed',
      S3VectorsErrorCode.THROTTLED,
      {
        operation: 'addVectors',
        ...SCOPE,
      },
      cause,
    );
    const decorated = attachPartialIds(base, 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(decorated.code).toBe(S3VectorsErrorCode.THROTTLED);
    expect(decorated.cause).toBe(cause);
  });

  it('keeps every other context field the original carried', () => {
    const decorated = attachPartialIds(coded(), 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(decorated.context.requestId).toBe('r-1');
    expect(decorated.context.writtenIds).toEqual(['a']);
  });

  it('says in the message how many landed, so a log line alone shows it was partial', () => {
    const decorated = attachPartialIds(coded(), 'addVectors', SCOPE, 'writtenIds', ['a', 'b']);
    expect(decorated.message).toContain('2 vector(s) were already durably written');
  });

  it('leaves the message alone when nothing landed', () => {
    const decorated = attachPartialIds(coded(), 'addVectors', SCOPE, 'writtenIds', []);
    expect(decorated.message).toBe('original failed');
    expect(decorated.context.writtenIds).toEqual([]);
  });

  it('uses the deleted wording for a delete', () => {
    const decorated = attachPartialIds(coded(), 'delete', SCOPE, 'deletedIds', ['a']);
    expect(decorated.message).toContain('were already durably deleted');
  });

  it('copies the attempted ids rather than aliasing the caller array', () => {
    const attempted = ['a', 'b'];
    const decorated = attachPartialIds(coded(), 'addVectors', SCOPE, 'writtenIds', [], attempted);
    attempted.push('c');
    expect(decorated.context.attemptedIds).toEqual(['a', 'b']);
  });

  it('wraps a raw throw from caller-supplied code as UNEXPECTED_ERROR', () => {
    const decorated = attachPartialIds(
      new Error('model blew up'),
      'addDocuments',
      SCOPE,
      'writtenIds',
      [],
    );
    expect(decorated.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(decorated.message).toContain('model blew up');
  });

  it('normalises a non-Error throw, so a caller always catches an Error', () => {
    const decorated = attachPartialIds('a string', 'addDocuments', SCOPE, 'writtenIds', []);
    expect(decorated).toBeInstanceOf(Error);
    expect(decorated.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
  });

  it('does not present a caller-code failure as an AWS one just because it carries a network error code', () => {
    // Whatever reaches `normalizeToS3VectorsError`'s wrapping branch came from
    // caller-supplied code (an `embedDocuments` that threw), never an
    // unwrapped AWS request failure — every AWS call site already wraps its
    // own failures before they can reach here. A bare `ENOTFOUND` from the
    // embeddings provider's own client must not pick up `awsErrorName`/
    // `retryable` as if the AWS request itself had failed that way.
    const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    const decorated = attachPartialIds(networkError, 'addDocuments', SCOPE, 'writtenIds', []);
    expect(decorated.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(decorated.context.awsErrorName).toBeUndefined();
    expect(decorated.context.retryable).toBeUndefined();
  });

  it('keeps the frames of the code that actually failed', () => {
    const base = coded();
    base.stack = 'S3VectorsError: original failed\n    at theRealThrowSite (file.ts:1:1)';
    const decorated = attachPartialIds(base, 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(decorated.stack).toContain('theRealThrowSite');
    expect(decorated.stack?.split('\n')[0]).toContain('were already durably written');
  });

  it('falls back to its own stack when the original has none', () => {
    const base = coded();
    // Deliberately removing the stack, which `Error` declares as `string |
    // undefined` but `exactOptionalPropertyTypes` will not let be assigned
    // `undefined` through the optional property.
    delete (base as { stack?: string }).stack;
    const decorated = attachPartialIds(base, 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(typeof decorated.stack).toBe('string');
  });

  it('falls back when the original stack has no recognisable frames', () => {
    const base = coded();
    base.stack = 'no frames here';
    const decorated = attachPartialIds(base, 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(decorated.stack).not.toContain('no frames here');
    // Falling back means the rebuilt error's own frames, not a header with a
    // fragment of the original spliced onto it.
    expect(decorated.stack).toContain('\n    at ');
  });

  it('falls back to its own stack when the original stack is not a string', () => {
    // Reachable only through a value forging this package's error brand, but a
    // decorator documented as throwing nothing must not throw inside error
    // handling whatever it is handed.
    const base = new S3VectorsError('original failed', S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'op',
    });
    Object.defineProperty(base, 'stack', { value: 42, configurable: true });
    const decorated = attachPartialIds(
      base,
      'op',
      { vectorBucketName: 'b', indexName: 'i' },
      'writtenIds',
      ['a'],
    );
    expect(typeof decorated.stack).toBe('string');
    expect(decorated.message).toContain('were already durably written');
  });
});

describe('attachOperation', () => {
  /** The frames under a stack's header line. */
  const framesOf = (error: Error): string => {
    const stack = error.stack ?? '';
    return stack.slice(stack.indexOf('\n    at '));
  };

  const failed = (
    message = 'addVectors failed on PutVectors (ThrottledException): slow',
  ): S3VectorsError =>
    new S3VectorsError(
      message,
      S3VectorsErrorCode.THROTTLED,
      { operation: 'addVectors', awsCommand: 'PutVectors', ...SCOPE, writtenIds: ['a'] },
      new Error('slow'),
    );

  it('returns the error itself when it already names the operation', () => {
    const original = failed();
    expect(attachOperation(original, 'addVectors', SCOPE)).toBe(original);
  });

  it('names the new operation and keeps the code, cause, stack and every other field', () => {
    const original = failed();
    const renamed = attachOperation(original, 'fromDocuments', SCOPE);
    expect(renamed).not.toBe(original);
    expect(renamed.code).toBe(original.code);
    expect(renamed.cause).toBe(original.cause);
    expect(renamed.context).toEqual({ ...original.context, operation: 'fromDocuments' });
    expect(framesOf(renamed)).toBe(framesOf(original));
  });

  it('never touches the original', () => {
    const original = failed();
    attachOperation(original, 'fromDocuments', SCOPE);
    expect(original.context.operation).toBe('addVectors');
    expect(original.message.startsWith('addVectors failed')).toBe(true);
  });

  it('swaps the operation leading the message and keeps everything after it', () => {
    const renamed = attachOperation(
      failed('addVectors failed on PutVectors: slow 1 vector(s) were already durably written.'),
      'retriever.invoke',
      SCOPE,
    );
    expect(renamed.message).toBe(
      'retriever.invoke failed on PutVectors: slow 1 vector(s) were already durably written.',
    );
    expect(renamed.stack?.startsWith(`S3VectorsError: ${renamed.message}`)).toBe(true);
  });

  it('keeps a message that does not lead with the operation whole', () => {
    // Including one that merely starts with the same letters.
    for (const message of ['k must be a positive integer', 'addVectorsX failed']) {
      expect(attachOperation(failed(message), 'fromDocuments', SCOPE).message).toBe(message);
    }
  });

  it('keeps a non-enumerable instance where it was attached', () => {
    const instance = { marker: 'the store' };
    const withInstance = attachInstance(failed(), 'fromDocuments', SCOPE, instance);
    const renamed = attachOperation(withInstance, 'fromTexts', SCOPE);
    expect(renamed.context.instance).toBe(instance);
    expect(Object.keys(renamed.context)).not.toContain('instance');
  });

  it.each([
    ['with a scope', SCOPE, { operation: 'retriever.invoke', ...SCOPE }],
    ['without one', undefined, { operation: 'retriever.invoke' }],
  ])('wraps a value that is not one of ours as UNEXPECTED_ERROR, %s', (_label, scope, context) => {
    const cause = new Error('handler blew up');
    const wrapped = attachOperation(cause, 'retriever.invoke', scope);
    expect(wrapped.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.context).toEqual(context);
  });
});

describe('attachInstance', () => {
  const instance = { marker: 'the store' };

  it('makes the handle reachable by direct access', () => {
    const decorated = attachInstance(coded(), 'fromDocuments', SCOPE, instance);
    expect(decorated.context.instance).toBe(instance);
  });

  it('keeps it out of every rendering a logger reaches for', () => {
    const decorated = attachInstance(coded(), 'fromDocuments', SCOPE, instance);
    expect(Object.keys(decorated.context)).not.toContain('instance');
    expect(JSON.stringify(decorated.context)).not.toContain('the store');
    expect({ ...decorated.context }).not.toHaveProperty('instance');
  });

  it('leaves the message and class untouched', () => {
    const decorated = attachInstance(coded(), 'fromDocuments', SCOPE, instance);
    expect(decorated.message).toBe('original failed');
    expect(decorated.code).toBe(S3VectorsErrorCode.THROTTLED);
  });

  it('names the factory the caller invoked, not the write it ran', () => {
    const decorated = attachInstance(coded(), 'fromDocuments', SCOPE, instance);
    expect(decorated.context.operation).toBe('fromDocuments');
    expect(decorated.context.requestId).toBe('r-1');
  });
});
