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

  it("lets a batch larger than a second's budget through, rather than waiting for ever", async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 100, requestsPerSecond: 1000 },
      clock,
    );

    // It can never be under the cap, so it goes once a full second's budget is there.
    await limiter.acquire(500, 'addVectors', SCOPE);

    expect(clock.slept).toEqual([]);
  });

  it('holds the configured rate when every request carries more than a second of it', async () => {
    // Each of these used to be charged one second's worth whatever it carried,
    // so 100 vectors/s with 500-vector batches wrote 500 a second — five times
    // the rate the caller set, and set in order to share the index's budget
    // with another writer. A batch is charged what it carries, and the ones
    // after it wait out the debt.
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 100, requestsPerSecond: 1000 },
      clock,
    );

    await limiter.acquire(500, 'addVectors', SCOPE);
    await limiter.acquire(500, 'addVectors', SCOPE);
    await limiter.acquire(500, 'addVectors', SCOPE);

    // 1,000 vectors beyond the opening burst, at 100 a second.
    expect(clock.slept.reduce((total, ms) => total + ms, 0)).toBe(10_000);
  });

  it('holds a request rate below one a second', async () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 2500, requestsPerSecond: 0.125 },
      clock,
    );

    await limiter.acquire(1, 'delete', SCOPE);
    await limiter.acquire(1, 'delete', SCOPE);

    // One request every eight seconds, not one a second. An eighth, because it
    // is exact in binary and the arithmetic here is then exact too.
    expect(clock.slept.reduce((total, ms) => total + ms, 0)).toBe(8_000);
  });

  it('never sleeps for longer than a second at a time, so an abort is noticed within one', async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 100, requestsPerSecond: 1000 },
      {
        now: clock.now,
        sleep: async (ms: number) => {
          controller.abort();
          await clock.sleep(ms);
        },
      },
    );

    await limiter.acquire(500, 'addVectors', SCOPE, controller.signal);
    // Five seconds of debt to wait out — and a caller who gives up during it.
    const error = await limiter
      .acquire(500, 'addVectors', SCOPE, controller.signal)
      .catch((e: unknown) => e as S3VectorsError);

    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.ABORTED);
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

/**
 * A clock for callers that wait at the same time. `fakeClock` above moves time
 * forward for whoever sleeps, which is right for one caller and wrong for
 * several: here a sleep is a wake-up time, and the clock goes to the earliest
 * one each step, as a real one reaches it first.
 */
function sharedClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  settle: () => Promise<void>;
  run: () => Promise<void>;
} {
  let current = 0;
  const asleep: { at: number; wake: () => void }[] = [];
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return {
    now: () => current,
    sleep: (ms: number) =>
      new Promise<void>((wake) => {
        asleep.push({ at: current + ms, wake });
      }),
    settle,
    run: async () => {
      for (await settle(); asleep.length > 0; await settle()) {
        asleep.sort((a, b) => a.at - b.at);
        const next = asleep.shift()!;
        current = next.at;
        next.wake();
      }
    },
  };
}

describe('who goes first when several writes wait', () => {
  it('admits them in the order they arrived, so a large write is not overtaken by smaller ones behind it', async () => {
    // Each waiter used to poll the budget on its own, and a request is admitted
    // once *its* size is there: a 100-vector request needs a tenth of what a
    // 1,000-vector one does, so it was always ready first. With smaller writes
    // still arriving — a `delete` beside an ingest, two writers on one store —
    // the large one waited until they stopped.
    const clock = sharedClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 1000, requestsPerSecond: 1000 },
      clock,
    );
    await limiter.acquire(1000, 'addVectors', SCOPE); // spend the second

    const admitted: [string, number][] = [];
    const arrive = (name: string, vectors: number): Promise<void> =>
      limiter.acquire(vectors, 'addVectors', SCOPE).then(() => {
        admitted.push([name, clock.now()]);
      });
    const all = [arrive('large', 1000), arrive('a', 100), arrive('b', 100), arrive('c', 100)];
    await clock.run();
    await Promise.all(all);

    // The large write after the one second its thousand vectors take to come
    // back, then a tenth of a second for each hundred behind it.
    expect(admitted).toEqual([
      ['large', 1000],
      ['a', 1100],
      ['b', 1200],
      ['c', 1300],
    ]);
  });

  it('lets a caller who gives up leave the line at once, without moving anyone behind it ahead', async () => {
    const clock = sharedClock();
    const limiter = createWriteRateLimiter(
      { vectorsPerSecond: 1000, requestsPerSecond: 1000 },
      clock,
    );
    await limiter.acquire(1000, 'addVectors', SCOPE);

    const admitted: [string, number][] = [];
    const controller = new AbortController();
    const first = limiter.acquire(1000, 'addVectors', SCOPE).then(() => {
      admitted.push(['first', clock.now()]);
    });
    const leaver = limiter
      .acquire(100, 'delete', SCOPE, controller.signal)
      .catch((e: unknown) => e as S3VectorsError);
    const last = limiter.acquire(100, 'addVectors', SCOPE).then(() => {
      admitted.push(['last', clock.now()]);
    });

    await clock.settle();
    controller.abort();
    const error = await leaver;

    // Gone before the clock has moved: not held for the wait of the one ahead.
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(clock.now()).toBe(0);

    await clock.run();
    await Promise.all([first, last]);

    // And the one behind it still waits for the one ahead of both.
    expect(admitted).toEqual([
      ['first', 1000],
      ['last', 1100],
    ]);
  });
});
