import { checkAborted, type StoreScope } from './signals.js';

/**
 * The write rate AWS documents per vector index.
 *
 * "Your application can achieve up to one thousand `PutVectors` or
 * `DeleteVectors` requests per second per vector index, or can insert or delete
 * up to two thousand five hundred vectors per second per vector index —
 * whichever limit is reached first. If you exceed the request rates, you might
 * receive a `429 TooManyRequestsException` error."
 *
 * Both counters are shared by writes and deletes, which is why one limiter
 * gates both.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-best-practices.html
 */
export const DEFAULT_WRITE_RATE_LIMIT: WriteRateLimitConfig = {
  vectorsPerSecond: 2500,
  requestsPerSecond: 1000,
};

/** How fast a store may write, in the two units AWS counts. */
export interface WriteRateLimitConfig {
  /** Vectors written or deleted per second; AWS's own limit is 2,500. */
  readonly vectorsPerSecond: number;
  /** `PutVectors` plus `DeleteVectors` calls per second; AWS's own limit is 1,000. */
  readonly requestsPerSecond: number;
}

/** What a write waits on before it is allowed to send. */
export interface WriteRateLimiter {
  /**
   * Wait until this request may be sent.
   *
   * Accepts: how many vectors the request carries, the public method to name in
   * an abort, the bucket and index, and the caller's signal.
   *
   * Returns: nothing, once the budget allows the request.
   *
   * Throws: `ABORTED` when the signal fires while waiting, or has already
   * fired — a caller who has given up should not be held by a queue.
   */
  acquire(
    vectors: number,
    operation: string,
    scope: StoreScope,
    signal?: AbortSignal,
  ): Promise<void>;
}

/** The clock the limiter paces against; replaced in tests, never in production. */
export interface RateLimiterClock {
  /** Milliseconds now, as `Date.now`. */
  readonly now: () => number;
  /** Resolve after this many milliseconds, as a timer does. */
  readonly sleep: (ms: number) => Promise<void>;
}

const SYSTEM_CLOCK: RateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** One rate, as a token bucket holding at most one second's worth. */
function bucket(perSecond: number, clock: RateLimiterClock): (tokens: number) => number {
  let available = perSecond;
  let last = clock.now();
  /** Takes what it can and answers how long to wait for the rest, 0 when none. */
  return (tokens: number): number => {
    const now = clock.now();
    available = Math.min(perSecond, available + ((now - last) / 1000) * perSecond);
    last = now;
    // A request larger than a whole second's budget would otherwise wait
    // forever: it can never be under the cap, so it waits one full second and
    // goes. AWS tolerates a burst; it is a sustained rate that is refused.
    const wanted = Math.min(tokens, perSecond);
    if (available >= wanted) {
      available -= wanted;
      return 0;
    }
    return Math.ceil(((wanted - available) / perSecond) * 1000);
  };
}

/**
 * Build the limiter one store paces its writes with.
 *
 * Accepts: the two rates, or `false` for a limiter that never waits, and the
 * clock to pace against.
 *
 * Returns: a {@link WriteRateLimiter} shared by every call on that store —
 * which is the point. `maxConcurrentBatchCalls` bounds one call's requests in
 * flight, so eight concurrent writes on one store had eighty, and AWS's limit
 * is a rate rather than a count of them.
 *
 * Throws: nothing here; the rates are validated at construction.
 *
 * Guarantees, and what the measurements behind them were: eight concurrent
 * `addVectors` of 25,000 vectors on one store, with the defaults and no
 * limiter, sent 18,078 vectors/s, took 120 `TooManyRequestsException`s and
 * **failed all eight calls** with 63,800 of 200,000 vectors written. The same
 * load through this limiter wrote all 200,000 with no failures and no
 * throttling at all, at 2,495 vectors/s. Two other candidates were measured on
 * that load and neither worked: a store-wide cap of ten requests in flight
 * still ran at 6,937 vectors/s and failed every call, and the AWS SDK's
 * `adaptive` retry mode dropped to 774 vectors/s and still failed every call.
 * A concurrency cap does not bound a rate (`docs/evidence/write-rate.md`).
 *
 * The limiter is per store instance, so separate processes writing to one index
 * can still exceed the limit between them; the SDK's own retries remain the
 * backstop for that.
 */
export function createWriteRateLimiter(
  config: WriteRateLimitConfig | false,
  clock: RateLimiterClock = SYSTEM_CLOCK,
): WriteRateLimiter {
  if (config === false) {
    return {
      acquire: (_vectors, operation, scope, signal) => {
        checkAborted(operation, signal, scope);
        return Promise.resolve();
      },
    };
  }

  const vectors = bucket(config.vectorsPerSecond, clock);
  const requests = bucket(config.requestsPerSecond, clock);

  return {
    async acquire(
      count: number,
      operation: string,
      scope: StoreScope,
      signal?: AbortSignal,
    ): Promise<void> {
      for (;;) {
        checkAborted(operation, signal, scope);
        const wait = Math.max(requests(1), vectors(count));
        if (wait === 0) return;
        await clock.sleep(wait);
      }
    },
  };
}
