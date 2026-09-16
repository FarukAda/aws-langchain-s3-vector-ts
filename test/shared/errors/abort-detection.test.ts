import { describe, it, expect } from '@jest/globals';

import { isAbortError } from '../../../src/shared/errors/aws-abort.js';

/**
 * One test per domain cell of `isAbortError`. The cause-chain walk exists
 * because `config.client` is a supported injection point: a custom request
 * handler may wrap its abort, and an unrecognised abort is reported as a
 * request failure — a cancelled call reported as something that went wrong.
 */
const abort = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });
const wrapping = (cause: unknown): Error => Object.assign(new Error('wrapped'), { cause });

describe('isAbortError', () => {
  it.each([
    ['a string', 'AbortError'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('returns false for %s', (_label, value) => {
    expect(isAbortError(value)).toBe(false);
  });

  it('recognises an abort directly', () => {
    expect(isAbortError(abort())).toBe(true);
  });

  it('returns false for an ordinary error with no cause', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('recognises an abort wrapped one level deep', () => {
    expect(isAbortError(wrapping(abort()))).toBe(true);
  });

  it('recognises an abort wrapped three levels deep', () => {
    expect(isAbortError(wrapping(wrapping(wrapping(abort()))))).toBe(true);
  });

  it('recognises an abort exactly at the depth bound — five cause hops', () => {
    // The bound is five hops from the value itself. Pinning both sides of it
    // is what stops the walk being quietly shortened or lengthened.
    let chain: unknown = abort();
    for (let i = 0; i < 5; i++) chain = wrapping(chain);
    expect(isAbortError(chain)).toBe(true);
  });

  it('gives up one hop past the bound', () => {
    let chain: unknown = abort();
    for (let i = 0; i < 6; i++) chain = wrapping(chain);
    expect(isAbortError(chain)).toBe(false);
  });

  it('gives up beyond the depth bound rather than walking an unbounded chain', () => {
    let chain: unknown = abort();
    for (let i = 0; i < 8; i++) chain = wrapping(chain);
    expect(isAbortError(chain)).toBe(false);
  });

  it('terminates on a cyclic cause chain instead of hanging', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isAbortError(a)).toBe(false);
  });

  it('returns false when the cause is not an object', () => {
    expect(isAbortError(wrapping('AbortError'))).toBe(false);
  });

  it('returns false for a wrapped error that is not an abort', () => {
    expect(isAbortError(wrapping(new Error('inner')))).toBe(false);
  });
});
