import { describe, it, expect } from '@jest/globals';

import { attachInstance, attachPartialIds } from '../../../src/shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { S3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';

/**
 * One test per domain cell of the error decorators (docs/CONTRACTS-DRAFT.md,
 * "Error model"). Two jobs: never lose track of what already committed, and
 * never become the apparent origin of a failure they only annotate.
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

  it('keeps the frames of the code that actually failed', () => {
    const base = coded();
    base.stack = 'S3VectorsError: original failed\n    at theRealThrowSite (file.ts:1:1)';
    const decorated = attachPartialIds(base, 'addVectors', SCOPE, 'writtenIds', ['a']);
    expect(decorated.stack).toContain('theRealThrowSite');
    expect(decorated.stack?.split('\n')[0]).toContain('were already durably written');
  });

  it('falls back to its own stack when the original has none', () => {
    const base = coded();
    base.stack = undefined;
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
});
