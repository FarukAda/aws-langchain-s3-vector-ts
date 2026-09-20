import { describe, it, expect } from '@jest/globals';

import { createWriteRateLimiter, DEFAULT_WRITE_RATE_LIMIT } from '../../src/internal/rate-limit.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';

const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

/**
 * A clock the test drives. The limiter paces work in wall-clock seconds, so a
 * test that used the real one would either be slow or be timing-dependent.
 */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  slept: number[];
} {
  let current = 0;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += ms;
    },
    slept,
  };
}

describe('the write rate limiter', () => {
  it('paces at the limits AWS documents per index by default', () => {
    // "up to one thousand PutVectors or DeleteVectors requests per second per
    // vector index, or … up to two thousand five hundred vectors per second"
    // (S3 Vectors best practices).
    expect(DEFAULT_WRITE_RATE_LIMIT).toEqual({ vectorsPerSecond: 2500, requestsPerSecond: 1000 });
  });

  it('lets a first burst through without waiting', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 2500, requestsPerSecond: 1000 },
      clock,
    );

    await limiter.acquire(500, 'addVectors', SCOPE);
    await limiter.acquire(500, 'addVectors', SCOPE);

    expect(clock.slept).toEqual([]);
  });

  it('waits once the second of vectors is spent, and only as long as it must', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 1000, requestsPerSecond: 1000 },
      clock,
    );

    await limiter.acquire(1000, 'addVectors', SCOPE); // the whole budget
    await limiter.acquire(500, 'addVectors', SCOPE); // half a second later

    expect(clock.slept).toEqual([500]);
  });

  it('waits on the request budget too, however small the writes are', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 2500, requestsPerSecond: 10 },
      clock,
    );

    for (let i = 0; i < 11; i++) await limiter.acquire(1, 'delete', SCOPE);

    expect(clock.slept).toEqual([100]);
  });

  it('refills as time passes, so a slow caller never waits', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 100, requestsPerSecond: 100 },
      clock,
    );

    for (let i = 0; i < 5; i++) {
      await limiter.acquire(100, 'addVectors', SCOPE);
      await clock.sleep(1000); // a second of the caller's own work
    }

    expect(clock.slept).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('never asks for more than one full budget, so a large batch still passes', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 100, requestsPerSecond: 1000 },
      clock,
    );

    await limiter.acquire(500, 'addVectors', SCOPE);
    await limiter.acquire(500, 'addVectors', SCOPE);

    // A batch larger than a second's budget costs a second, not five.
    expect(clock.slept).toEqual([1000]);
  });

  it('ends the wait when the caller aborts', async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 10, requestsPerSecond: 1000 },
      {
        now: clock.now,
        sleep: async (ms: number) => {
          controller.abort();
          await clock.sleep(ms);
        },
      },
    );

    await limiter.acquire(10, 'addVectors', SCOPE, controller.signal);
    const error: S3VectorsError = await limiter
      .acquire(10, 'addVectors', SCOPE, controller.signal)
      .then(
        () => {
          throw new Error('expected the wait to be aborted');
        },
        (e: unknown) => e as S3VectorsError,
      );

    expect(error.code).toBe(S3VectorsErrorCode.ABORTED);
    expect(error.message).toContain('addVectors');
  });

  it('does nothing at all when the limit is turned off', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(false, clock);

    for (let i = 0; i < 100; i++) await limiter.acquire(5000, 'addVectors', SCOPE);

    expect(clock.slept).toEqual([]);
  });
});

describe('what the limiter spends', () => {
  it('does not charge a budget for work the other budget made it wait for', async () => {
    // `Math.max(requests(1), vectors(count))` evaluates both arms, and each
    // bucket *commits* its deduction whenever it can afford it. So when one
    // axis has to wait, the other has already been charged — and is charged
    // again on the retry after the sleep. Measured over 4,000 random
    // configurations, 60% over-consume tokens this way; this is the smallest
    // configuration where it also changes the pacing, which is what a caller
    // can observe. The effect is always conservative — it can only slow the
    // sender — but the rate a caller configured is then not the rate they get.
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ requestsPerSecond: 2, vectorsPerSecond: 3 }, clock);

    await limiter.acquire(2, 'addVectors', SCOPE);
    await limiter.acquire(2, 'addVectors', SCOPE);

    // Both budgets can afford the second call after 1/3 s of vector refill.
    // Double-spending pushes it to a full second.
    expect(clock.now()).toBeLessThan(500);
  });
});

describe('a clock that steps backwards', () => {
  it('does not stall every writer for the size of the step', async () => {
    // Buckets refill from (now - last)/1000 * perSecond. A negative delta
    // drives `available` far negative and the resulting wait is the whole
    // step, so an NTP correction, a VM snapshot restore or a container whose
    // clock is fixed after start blocks every writer on the store for that
    // long — with a non-unref'd timer holding the event loop open meanwhile.
    let current = 0;
    const slept: number[] = [];
    const clock = {
      now: () => current,
      sleep: async (ms: number) => {
        slept.push(ms);
        current += ms;
      },
    };
    const limiter = createWriteRateLimiter({ requestsPerSecond: 10, vectorsPerSecond: 100 }, clock);

    await limiter.acquire(100, 'addVectors', SCOPE);
    current -= 60 * 60 * 1000; // an hour backwards, between two calls
    await limiter.acquire(1, 'addVectors', SCOPE);

    expect(Math.max(0, ...slept)).toBeLessThan(2_000);
  }, 15_000);
});
