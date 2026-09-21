import { DeleteVectorsCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, mockExistingIndex } from './helpers.js';

/**
 * Eight concurrent `addVectors` on one store, with the defaults and no
 * limiter, failed every call with `THROTTLED` against live AWS. The cap that
 * existed — `maxConcurrentBatchCalls` — bounds one call's requests in flight,
 * not the store's rate, and AWS's limit is a rate
 * (`docs/evidence/write-rate.md`).
 */
const docs = (n: number): Document[] =>
  Array.from({ length: n }, (_, i) => new Document({ pageContent: `d-${i}` }));
const vectors = (n: number): number[][] => Array.from({ length: n }, () => [0.1, 0.2]);

/**
 * How long `work` took, on a clock the test owns.
 *
 * These used to read the wall clock and assert upper bounds on it — "under 100
 * ms", "under 140" — around a dozen mocked requests. That measures the runner
 * as much as the limiter: with ts-jest and coverage instrumentation on, a loaded
 * Windows or macOS runner can take longer than that with nothing pacing at all,
 * and every leg of that matrix is a required release check. So the limiter's
 * own clock is faked instead — `setTimeout` and `performance`, which are all it
 * reads — and the answer is exact: no waiting is 0, not "fast enough".
 *
 * Only those two are faked. The suite's own `afterEach` waits on a real
 * `setImmediate`, which a fully faked clock would never fire.
 */
async function virtualMs(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  let finished: number | undefined;
  const running = work().then(() => {
    finished = performance.now();
  });
  // First with no time passing at all, then a step at a time. Five virtual
  // seconds is far more than any budget below needs to refill.
  await jest.advanceTimersByTimeAsync(0);
  for (let step = 0; step < 100 && finished === undefined; step++) {
    await jest.advanceTimersByTimeAsync(50);
  }
  await running;
  return (finished as number) - started;
}

describe('the write rate limit', () => {
  let client: ReturnType<typeof createMockClient>['client'];
  let mock: ReturnType<typeof createMockClient>['mock'];

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'Date',
        'hrtime',
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
      ],
    });
    ({ client, mock } = createMockClient());
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteVectorsCommand).resolves({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('paces writes against one budget shared by every call on the store', async () => {
    // 20 requests a second, so a burst of 20 goes at once and the rest waits.
    // One call of 12 is inside the burst; two of them together are not, which
    // is the whole point: the budget belongs to the store, not to the call.
    const limited = {
      ...BASE_CONFIG,
      client,
      writeRateLimit: { requestsPerSecond: 20, vectorsPerSecond: 100000 },
    };
    const single = new AmazonS3Vectors(undefined, limited);
    const singleMs = await virtualMs(() =>
      single.addVectors(vectors(12), docs(12), { batchSize: 1 }),
    );

    const shared = new AmazonS3Vectors(undefined, limited);
    const pairMs = await virtualMs(() =>
      Promise.all([
        shared.addVectors(vectors(12), docs(12), { batchSize: 1 }),
        shared.addVectors(vectors(12), docs(12), { batchSize: 1 }),
      ]),
    );

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(36);
    expect(singleMs).toBe(0);
    // Four requests past the burst of twenty, at twenty a second.
    expect(pairMs).toBe(200);
  });

  it('paces deletes from the same budget, as AWS counts them', async () => {
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      writeRateLimit: { requestsPerSecond: 20, vectorsPerSecond: 100000 },
    });
    const ids = Array.from({ length: 26 }, (_, i) => `id-${i}`);

    const ms = await virtualMs(() => store.delete({ ids, batchSize: 1 }));

    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(26);
    // Six requests past the burst of twenty, at twenty a second.
    expect(ms).toBe(300);
  });

  it('sends without waiting when the limit is turned off', async () => {
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      writeRateLimit: false,
    });
    const ms = await virtualMs(() => store.addVectors(vectors(8), docs(8), { batchSize: 1 }));

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(8);
    expect(ms).toBe(0);
  });

  it('refuses a rate that cannot pace anything, at construction', () => {
    const build = (writeRateLimit: unknown): S3VectorsError => {
      try {
        new AmazonS3Vectors(undefined, {
          ...BASE_CONFIG,
          client,
          writeRateLimit: writeRateLimit as never,
        });
      } catch (error: unknown) {
        return error as S3VectorsError;
      }
      throw new Error('expected a refusal');
    };

    expect(build({ vectorsPerSecond: 0 }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(build({ vectorsPerSecond: 0 }).message).toContain('writeRateLimit.vectorsPerSecond');
    expect(build({ requestsPerSecond: -1 }).message).toContain('writeRateLimit.requestsPerSecond');
    expect(build({ requestsPerSecond: Number.POSITIVE_INFINITY }).code).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
    expect(build(true).message).toContain('writeRateLimit');
    expect(build('fast').code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('keeps AWS’s own per-index limits when nothing is configured', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    // Well inside 2,500 vectors and 1,000 requests a second: no pacing at all.
    const ms = await virtualMs(() => store.addVectors(vectors(100), docs(100), { batchSize: 50 }));

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(2);
    expect(ms).toBe(0);
  });
});
