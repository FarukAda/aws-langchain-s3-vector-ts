import { describe, it, expect } from '@jest/globals';

import { openWindow } from '../../src/internal/concurrency.js';
import { gate } from '../helpers.js';

/**
 * One test per domain cell of the concurrency window.
 *
 * The window is the one place this package decides how much work runs at once
 * and what happens to the rest when something fails. Both the batched
 * operations and the embed pipeline had their own copy of that decision, and
 * the copies did not agree: one dispatched in fixed groups, so a slow request
 * held back every request behind it until its whole group settled.
 */
describe('openWindow', () => {
  it('runs up to the cap at once and no more', async () => {
    let inFlight = 0;
    let peak = 0;
    const release = gate();
    const window = openWindow<number>(2);
    // The loop is not awaited here: `launch` blocks once the window is full,
    // which is the behaviour under test, so awaiting it inline would deadlock
    // against the gate the test itself has to open.
    const launching = (async () => {
      for (let i = 0; i < 5; i++) {
        await window.launch(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await release.promise;
          inFlight -= 1;
          return i;
        });
      }
    })();
    await Promise.resolve();
    release.open();
    await launching;
    await window.settle();
    expect(peak).toBe(2);
    expect(inFlight).toBe(0);
  });

  it('starts the next unit as soon as one slot frees, not when a group ends', async () => {
    // Three units, a cap of two, and only the *first* one blocked. With a
    // sliding window the third starts the moment the second finishes. With
    // fixed groups of two it would wait for the blocked first as well.
    const blockFirst = gate();
    const started: number[] = [];
    const window = openWindow<number>(2);
    await window.launch(async () => {
      started.push(0);
      await blockFirst.promise;
      return 0;
    });
    await window.launch(() => {
      started.push(1);
      return Promise.resolve(1);
    });
    await window.launch(() => {
      started.push(2);
      return Promise.resolve(2);
    });
    expect(started).toEqual([0, 1, 2]);
    blockFirst.open();
    await window.settle();
  });

  it('keeps results in launch order, not completion order', async () => {
    const releaseFirst = gate();
    const window = openWindow<string>(4);
    await window.launch(async () => {
      await releaseFirst.promise;
      return 'first';
    });
    await window.launch(() => {
      releaseFirst.open();
      return Promise.resolve('second');
    });
    const outcome = await window.settle();
    expect(outcome.results).toEqual(['first', 'second']);
  });

  it('latches the first failure and leaves later ones alone', async () => {
    const window = openWindow<string>(4);
    await window.launch(() => Promise.reject(new Error('first')));
    await window.launch(() => Promise.reject(new Error('second')));
    const outcome = await window.settle();
    expect(outcome.failed).toBe(true);
    expect((outcome.error as Error).message).toBe('first');
  });

  it('reports a failure even when the reason is undefined', async () => {
    // `unknown` cannot rule out a rejection reason of null or undefined, which
    // is why the window carries a flag rather than testing `error !== undefined`.
    const window = openWindow<string>(2);
    window.fail(undefined);
    const outcome = await window.settle();
    expect(outcome.failed).toBe(true);
    expect(outcome.error).toBeUndefined();
  });

  it('leaves a slot for the results of units that did succeed', async () => {
    const window = openWindow<string>(4);
    await window.launch(() => Promise.resolve('a'));
    await window.launch(() => Promise.reject(new Error('b')));
    await window.launch(() => Promise.resolve('c'));
    const outcome = await window.settle();
    expect(outcome.results).toEqual(['a', undefined, 'c']);
  });

  it('says it has failed before it is settled, so a caller can stop feeding it', async () => {
    const window = openWindow<string>(1);
    expect(window.hasFailed()).toBe(false);
    await window.launch(() => Promise.reject(new Error('stop')));
    // One more launch waits on the failed unit, which is what surfaces it.
    await window.launch(() => Promise.resolve('never mind'));
    expect(window.hasFailed()).toBe(true);
    await window.settle();
  });

  it('waits for every launched unit before settling, so a late success is reported', async () => {
    const releaseLate = gate();
    const window = openWindow<string>(4);
    await window.launch(() => Promise.reject(new Error('early')));
    await window.launch(async () => {
      await releaseLate.promise;
      return 'late';
    });
    releaseLate.open();
    const outcome = await window.settle();
    expect(outcome.results).toEqual([undefined, 'late']);
    expect(outcome.failed).toBe(true);
  });

  it('settles cleanly when nothing was ever launched', async () => {
    const outcome = await openWindow<string>(3).settle();
    expect(outcome).toEqual({ results: [], failed: false, error: undefined });
  });
});
