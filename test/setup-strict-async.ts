/**
 * Fail the run on a rejection nobody handled, or a warning Node emits.
 *
 * This package is full of deliberately un-awaited promises: a memoised index
 * creation several callers share, `allSettled` groups, a write window that
 * settles out of order, an abort that rejects a caller's wait while the work
 * it was waiting on continues. Every one of those is a place where a rejection
 * can end up with no handler — and Node only prints a warning, so a test suite
 * stays green while the process would, in production, be one unhandled
 * rejection away from an exit.
 *
 * Jest does not fail a test for that by default. This makes it fail, attributed
 * to whichever test was running when it happened.
 */
import { afterAll, afterEach, beforeAll } from '@jest/globals';

const failures: string[] = [];

const onUnhandledRejection = (reason: unknown): void => {
  failures.push(`unhandled rejection: ${String((reason as Error)?.stack ?? reason)}`);
};

const onWarning = (warning: Error): void => {
  // Node's own deprecation and leak warnings. A MaxListenersExceededWarning
  // here would mean an abort listener is being added per call and never
  // removed — exactly the leak `raceAbort` is written to avoid.
  if (warning.name === 'MaxListenersExceededWarning' || warning.name === 'DeprecationWarning') {
    failures.push(`${warning.name}: ${warning.message}`);
  }
};

beforeAll(() => {
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('warning', onWarning);
});

afterEach(async () => {
  // A rejection is reported on a later turn than the one that created it, so
  // give the microtask queue a chance to deliver it to the test that caused it.
  await new Promise((resolve) => setImmediate(resolve));
  if (failures.length > 0) {
    const reported = failures.join('\n');
    failures.length = 0;
    throw new Error(`Unhandled async failure during this test:\n${reported}`);
  }
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandledRejection);
  process.off('warning', onWarning);
});
