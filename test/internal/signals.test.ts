import { describe, it, expect, jest } from '@jest/globals';

import { checkAborted, raceAbort } from '../../src/internal/signals.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';

/**
 * One test per domain cell of `checkAborted`.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const thrownBy = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('checkAborted', () => {
  it('returns when no signal is supplied', () => {
    expect(() => {
      checkAborted('op', undefined, SCOPE);
    }).not.toThrow();
  });

  it('returns when the signal is present but has not fired', () => {
    const ac = new AbortController();
    expect(() => {
      checkAborted('op', ac.signal, SCOPE);
    }).not.toThrow();
  });

  it('throws ABORTED once the signal has fired', () => {
    const ac = new AbortController();
    ac.abort();
    const error = thrownBy(() => {
      checkAborted('op', ac.signal, SCOPE);
    });
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
  });

  it('names the operation in the message, so a caller can tell which call was cancelled', () => {
    const ac = new AbortController();
    ac.abort();
    const error = thrownBy(() => {
      checkAborted('addDocuments', ac.signal, SCOPE);
    });
    expect((error as Error).message).toContain('addDocuments');
  });

  it('normalises a non-Error abort reason, so `cause` is always an Error', () => {
    const ac = new AbortController();
    ac.abort('took too long');
    const error = thrownBy(() => {
      checkAborted('op', ac.signal, SCOPE);
    });
    const { cause } = error as { cause?: unknown };
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('took too long');
  });

  it('preserves the default DOMException reason as the cause', () => {
    const ac = new AbortController();
    ac.abort();
    const error = thrownBy(() => {
      checkAborted('op', ac.signal, SCOPE);
    });
    const { cause } = error as { cause?: unknown };
    expect((cause as { name?: string })?.name).toBe('AbortError');
  });
});

/**
 * One test per domain cell of `raceAbort`. It lets a caller's own wait end
 * early without cancelling work other callers depend on — the shared
 * index-creation memo and a retriever invocation.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

/** A promise plus the handles to settle it from the test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('raceAbort', () => {
  it('returns the factory result untouched when no signal is given', async () => {
    await expect(raceAbort(() => Promise.resolve('value'), undefined, 'op', SCOPE)).resolves.toBe(
      'value',
    );
  });

  it('never calls the factory when the signal has already fired', async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    const factory = async (): Promise<string> => {
      called = true;
      return 'value';
    };
    const error = await raceAbort(factory, ac.signal, 'op', SCOPE).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    // The cell that matters: a promise argument would already have dispatched
    // a billable call for a caller who had already cancelled.
    expect(called).toBe(false);
  });

  it('rejects the waiting caller when the signal fires mid-flight, leaving the work running', async () => {
    const ac = new AbortController();
    const work = deferred<string>();
    let settled = false;
    void work.promise.then(() => {
      settled = true;
    });

    const waited = raceAbort(() => work.promise, ac.signal, 'op', SCOPE).catch((e: unknown) =>
      codeOf(e),
    );
    ac.abort();
    expect(await waited).toBe(S3VectorsErrorCode.ABORTED);

    // The shared work is untouched: it completes for whoever else awaits it.
    work.resolve('value');
    await work.promise;
    expect(settled).toBe(true);
  });

  it('resolves with the value when the work settles first', async () => {
    const ac = new AbortController();
    await expect(raceAbort(() => Promise.resolve(7), ac.signal, 'op', SCOPE)).resolves.toBe(7);
  });

  it('removes its listener on the fulfil path, so many waits leave none behind', async () => {
    const ac = new AbortController();
    const removals = jest.spyOn(ac.signal, 'removeEventListener');
    await raceAbort(() => Promise.resolve('value'), ac.signal, 'op', SCOPE);
    expect(removals).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on the reject path too', async () => {
    const ac = new AbortController();
    const removals = jest.spyOn(ac.signal, 'removeEventListener');
    await raceAbort(() => Promise.reject(new Error('boom')), ac.signal, 'op', SCOPE).catch(
      () => undefined,
    );
    expect(removals).toHaveBeenCalledTimes(1);
  });

  it('surfaces the underlying failure when the work rejects before any abort', async () => {
    const ac = new AbortController();
    const error = await raceAbort(
      () => Promise.reject(new Error('boom')),
      ac.signal,
      'op',
      SCOPE,
    ).catch((e: unknown) => e);
    expect((error as Error).message).toBe('boom');
  });

  it('normalises a non-Error rejection, so a caller always catches an Error', async () => {
    const ac = new AbortController();
    // The cast is the behaviour under test: caller-supplied code (an
    // embeddings model, an injected client's request handler) can reject with
    // anything, and the error model says a caller always catches an Error.
    const notAnError = 'a string' as unknown as Error;
    const error = await raceAbort(() => Promise.reject(notAnError), ac.signal, 'op', SCOPE).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
  });

  it('observes a rejection that arrives after the caller aborted, so it is never unhandled', async () => {
    const ac = new AbortController();
    const work = deferred<string>();
    const waited = raceAbort(() => work.promise, ac.signal, 'op', SCOPE).catch((e: unknown) =>
      codeOf(e),
    );
    ac.abort();
    expect(await waited).toBe(S3VectorsErrorCode.ABORTED);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    work.reject(new Error('late failure'));
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('turns a synchronous throw from the factory into a rejection', async () => {
    const ac = new AbortController();
    const error = await raceAbort<string>(
      () => {
        throw new Error('sync boom');
      },
      ac.signal,
      'op',
      SCOPE,
    ).catch((e: unknown) => e);
    expect((error as Error).message).toBe('sync boom');
  });
});
