/**
 * Hides how fast this package is willing to write.
 *
 * AWS bounds a vector index in two units at once — requests a second and vectors
 * a second — and nothing about a caller's code says which one it will reach
 * first. One limiter per store holds both budgets, shared by writes and deletes,
 * so concurrency can be tuned without any call site knowing there is a budget.
 */
import type { StoreScope } from '../shared/scope.js';
import { checkAborted, raceAbort } from './signals.js';

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
   *
   * Guarantees: requests are admitted in the order they asked, whatever their
   * sizes, so none waits for longer than the ones ahead of it take. A request
   * that gives up leaves its place without moving anyone past those in front.
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
  // performance.now(), not Date.now(): this reads the clock only to measure
  // elapsed time, and Date.now() is not monotonic. An NTP step correction, a VM
  // snapshot restore, or a container whose clock is fixed shortly after start
  // makes `now - last` negative, which drives a bucket's balance far below zero
  // and produces a wait the size of the step — an hour's correction blocked
  // every writer on the store for an hour. performance.now() cannot step
  // backwards, and since only differences are used, nothing else changes.
  now: () => performance.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * The longest a waiting write sleeps before it looks at its signal again, and
 * so the longest an abort goes unnoticed while it waits.
 */
const LONGEST_SLEEP_MS = 1000;

/**
 * One rate, as a token bucket holding at most one second's worth — and able to
 * owe more than that.
 */
interface Bucket {
  /** How long to wait before `tokens` could be taken, 0 when they can be now. Takes nothing. */
  readonly waitFor: (tokens: number) => number;
  /** Take `tokens`, all of them. Only valid straight after a `waitFor` that answered 0. */
  readonly take: (tokens: number) => void;
}

function bucket(perSecond: number, clock: RateLimiterClock): Bucket {
  let available = perSecond;
  let last = clock.now();

  // What has to be there before a request may go. A request larger than a whole
  // second's budget would otherwise wait forever — it can never be under the
  // cap — so it goes once a full second's worth is available. AWS tolerates a
  // burst; it is a sustained rate that is refused.
  //
  // It is *admitted* on a second's worth and *charged* what it carries (see
  // `take`), which leaves the balance negative and makes the requests after it
  // wait the debt out. Charged only the second's worth it was admitted on, a
  // rate below the size of one request was never held at all: 100 vectors/s
  // with 500-vector batches wrote 500 a second, and 0.1 requests/s sent one a
  // second — five and ten times what a caller had asked for, and asked for in
  // order to share an index's budget with another writer.
  const admittedOn = (tokens: number): number => Math.min(tokens, perSecond);

  const refill = (): void => {
    const now = clock.now();
    // Clamped at zero so that a clock which does step backwards — an injected
    // one, or a future change of source — cannot credit the bucket negatively.
    // The monotonic source above is the reason it should not happen; this is
    // the reason it cannot matter if it does.
    const elapsed = Math.max(0, now - last);
    available = Math.min(perSecond, available + (elapsed / 1000) * perSecond);
    last = now;
  };

  return {
    // Peek, never commit. The two budgets are consulted together, and whichever
    // of them can be satisfied must not spend anything while the other is
    // making the caller wait — it would be charged again on the retry after the
    // sleep, so a call that looped n times cost n tokens on the axis that was
    // never the constraint. Measured across 4,000 configurations, 60% of them
    // over-consumed; some also paced slower than the rate the caller set.
    waitFor: (tokens: number): number => {
      refill();
      const wanted = admittedOn(tokens);
      return available >= wanted ? 0 : Math.ceil(((wanted - available) / perSecond) * 1000);
    },
    take: (tokens: number): void => {
      available -= tokens;
    },
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

  // Settles once every request that arrived so far has gone, or given up. Each
  // arrival waits on it and then puts its own turn in its place, which is the
  // whole queue: requests are admitted in the order they arrived.
  //
  // They used to poll the budgets independently, and a request is admitted once
  // *its* size is there — so a 100-vector request, needing a tenth of what a
  // 1,000-vector one does, was always ready first. While smaller writes kept
  // arriving, a `delete` beside an ingest or a second writer on the store, the
  // large one was passed by every one of them and went when they stopped.
  //
  // In line, nothing is lost to the wait: the request at the front is admitted
  // on at most a second's worth (`admittedOn`), which is where a bucket stops
  // filling, so no vector that could have been written is refused a place.
  let line: Promise<void> = Promise.resolve();

  return {
    async acquire(
      count: number,
      operation: string,
      scope: StoreScope,
      signal?: AbortSignal,
    ): Promise<void> {
      checkAborted(operation, signal, scope);
      const ahead = line;
      let leave!: () => void;
      line = new Promise<void>((resolve) => {
        leave = resolve;
      });
      try {
        // Raced, so a caller who gives up is not held for the wait of whoever is
        // in front. `ahead` only ever resolves.
        await raceAbort(() => ahead, signal, operation, scope);
        for (;;) {
          checkAborted(operation, signal, scope);
          // Both asked, neither charged, and only both together committed — so
          // the budget that was ready does not pay for the one that was not.
          const wait = Math.max(requests.waitFor(1), vectors.waitFor(count));
          if (wait === 0) {
            requests.take(1);
            vectors.take(count);
            return;
          }
          // In slices, because a sleep cannot be interrupted and the signal is
          // only read between them. A wait used to be a second at most; a debt
          // can be many, and a caller who has given up should not be held for it.
          await clock.sleep(Math.min(wait, LONGEST_SLEEP_MS));
        }
      } finally {
        // Whoever is behind goes once everyone ahead of *them* has. For a
        // request that was admitted that is now. For one that left the line
        // early it is not — releasing straight away would start the one behind
        // beside the one still in front, which is the overtaking this line
        // exists to end.
        void ahead.then(leave);
      }
    },
  };
}
