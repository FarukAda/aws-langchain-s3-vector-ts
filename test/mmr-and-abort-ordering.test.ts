import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';

/**
 * What a search spends, and when (F-06, F-10, F-17).
 *
 * Three separate promises about ordering, none of them kept:
 *
 * - `maxConcurrentBatchCalls` bounds how many AWS calls this store may have in
 *   flight. MMR's `GetVectors` fan-out never received it, so a store configured
 *   for strictly sequential calls issued up to ten at once — the default of the
 *   helper it delegates to.
 * - MMR's `k`, `fetchK`, `lambda` and filter are documented as checked before
 *   the billable `embedQuery`. They are checked first inside `mmrSearch`, which
 *   the store calls *after* embedding, so an invalid `k` cost an embedding
 *   round trip before failing.
 * - `deleteIndex({ signal })` is documented as ending the wait for an in-flight
 *   index creation early. It awaited the shared creation without racing the
 *   signal, so the caller waited for the creation regardless.
 *
 * The fake client here is hand-built rather than mocked, because what is under
 * test is concurrency and timing: it has to be possible to hold a response open
 * and to count how many calls overlap.
 */

interface Recorder {
  readonly commands: string[];
  peakConcurrency: number;
  embedCalls: number;
}

interface Scripted {
  /** Resolves the pending `GetIndex`, for the tests that hold one open. */
  releaseIndex: () => void;
  readonly recorder: Recorder;
  readonly store: AmazonS3Vectors;
}

function scriptedStore(
  config: Partial<AmazonS3VectorsConfig> = {},
  options: { candidates?: number; holdGetIndex?: boolean } = {},
): Scripted {
  const recorder: Recorder = { commands: [], peakConcurrency: 0, embedCalls: 0 };
  let inFlight = 0;
  let release: () => void = () => undefined;
  const indexGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const candidates = options.candidates ?? 0;
  const keys = Array.from({ length: candidates }, (_, i) => `k${i}`);

  const client = {
    config: { serviceId: 'S3Vectors' as const },
    async send(command: object): Promise<unknown> {
      const name = command.constructor.name.replace(/Command$/, '');
      recorder.commands.push(name);
      inFlight += 1;
      recorder.peakConcurrency = Math.max(recorder.peakConcurrency, inFlight);
      try {
        if (name === 'GetIndex' && options.holdGetIndex === true) await indexGate;
        await Promise.resolve();
        switch (name) {
          case 'GetIndex':
            return {
              index: {
                indexName: 'test-index',
                metadataConfiguration: { nonFilterableMetadataKeys: ['_page_content'] },
              },
            };
          case 'QueryVectors':
            return {
              distanceMetric: 'cosine',
              vectors: keys.map((key) => ({ key, metadata: { _page_content: key } })),
            };
          case 'GetVectors': {
            const asked = (command as { input: { keys?: string[] } }).input.keys ?? [];
            return {
              vectors: asked.map((key) => ({
                key,
                data: { float32: [0.1, 0.2, 0.3] },
                metadata: { _page_content: key },
              })),
            };
          }
          default:
            return {};
        }
      } finally {
        inFlight -= 1;
      }
    },
  };

  const embeddings: EmbeddingsInterface = {
    embedDocuments: async (texts: string[]) => {
      recorder.embedCalls += 1;
      return texts.map(() => [0.1, 0.2, 0.3]);
    },
    embedQuery: async () => {
      recorder.embedCalls += 1;
      return [0.1, 0.2, 0.3];
    },
  };

  const store = new AmazonS3Vectors(embeddings, {
    vectorBucketName: 'test-bucket',
    indexName: 'test-index',
    ...config,
    client: client as unknown as AmazonS3VectorsConfig['client'],
  });

  return { store, recorder, releaseIndex: release };
}

async function failureOf(call: () => Promise<unknown>): Promise<S3VectorsError | undefined> {
  try {
    await call();
    return undefined;
  } catch (error: unknown) {
    if (isS3VectorsError(error)) return error;
    throw error;
  }
}

describe('MMR honours the concurrency cap the store was configured with', () => {
  it('fans out GetVectors no wider than maxConcurrentBatchCalls', async () => {
    // 250 candidates is three GetVectors batches at the 100-key ceiling, so a
    // cap of 1 is observably different from the helper's default of 10.
    const { store, recorder } = scriptedStore({ maxConcurrentBatchCalls: 1 }, { candidates: 250 });

    await store.maxMarginalRelevanceSearch('q', { k: 5, fetchK: 250 });

    expect(recorder.commands.filter((c) => c === 'GetVectors')).toHaveLength(3);
    expect(recorder.peakConcurrency).toBe(1);
  });

  it('still fans out in parallel when the cap allows it', async () => {
    const { store, recorder } = scriptedStore({ maxConcurrentBatchCalls: 3 }, { candidates: 250 });

    await store.maxMarginalRelevanceSearch('q', { k: 5, fetchK: 250 });

    expect(recorder.peakConcurrency).toBeGreaterThan(1);
    expect(recorder.peakConcurrency).toBeLessThanOrEqual(3);
  });
});

describe('MMR validates before it spends the billable embedding call', () => {
  it.each([
    ['k', { k: 0, fetchK: 20 }],
    ['fetchK', { k: 4, fetchK: 0 }],
    ['lambda', { k: 4, fetchK: 20, lambda: 5 }],
    ['filter', { k: 4, fetchK: 20, filter: { $nope: 1 } }],
  ])('refuses an invalid %s without embedding the query', async (_label, options) => {
    const { store, recorder } = scriptedStore({}, { candidates: 10 });

    const error = await failureOf(async () => store.maxMarginalRelevanceSearch('q', options));

    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(recorder.embedCalls).toBe(0);
    expect(recorder.commands).toEqual([]);
  });

  it('still embeds once for options it accepts', async () => {
    const { store, recorder } = scriptedStore({}, { candidates: 3 });

    await store.maxMarginalRelevanceSearch('q', { k: 2, fetchK: 3 });

    expect(recorder.embedCalls).toBe(1);
  });
});

describe('deleteIndex stops waiting for an in-flight creation when the signal fires', () => {
  it('rejects ABORTED without waiting for the creation to finish', async () => {
    const { store, recorder, releaseIndex } = scriptedStore({}, { holdGetIndex: true });

    // Start a write, which begins the shared GetIndex and leaves it open.
    const write = store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })]);
    await Promise.resolve();
    await Promise.resolve();

    const controller = new AbortController();
    const deletion = failureOf(async () => store.deleteIndex({ signal: controller.signal }));
    controller.abort();

    const error = await deletion;

    expect(error?.code).toBe(S3VectorsErrorCode.ABORTED);
    // The point of the finding: the wait ended early, so DeleteIndex was never
    // issued and the creation was never waited out.
    expect(recorder.commands).not.toContain('DeleteIndex');

    releaseIndex();
    await write.catch(() => undefined);
  });

  it('still serialises behind the creation when no signal is given', async () => {
    const { store, recorder, releaseIndex } = scriptedStore({}, { holdGetIndex: true });

    const write = store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })]);
    await Promise.resolve();
    await Promise.resolve();

    const deletion = store.deleteIndex();
    releaseIndex();
    await deletion;
    await write.catch(() => undefined);

    // DeleteIndex must come after the GetIndex it was serialised behind.
    expect(recorder.commands.indexOf('DeleteIndex')).toBeGreaterThan(
      recorder.commands.indexOf('GetIndex'),
    );
  });
});

/**
 * No message may throw while it is being built (F-31, completing P4).
 *
 * `String()` on an object with a null prototype raises "Cannot convert object
 * to primitive value", so a rejection that interpolated caller data could fail
 * *while reporting* the caller's mistake, and the formatting error replaced it.
 * P4 fixed the vector-component case; these are the rest of the sites that read
 * a caller's value into a message.
 */
describe('a rejection reports the input, not a failure to describe it', () => {
  const hostile = (): number => Object.create(null) as number;

  it('reports a null-prototype k as VALIDATION', async () => {
    const { store } = scriptedStore({}, { candidates: 3 });
    const error = await failureOf(async () =>
      store.maxMarginalRelevanceSearch('q', { k: hostile(), fetchK: 3 }),
    );
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('reports a null-prototype lambda as VALIDATION', async () => {
    const { store } = scriptedStore({}, { candidates: 3 });
    const error = await failureOf(async () =>
      store.maxMarginalRelevanceSearch('q', { k: 2, fetchK: 3, lambda: hostile() }),
    );
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('reports a null-prototype pageSize as VALIDATION', async () => {
    const { store } = scriptedStore({}, { candidates: 3 });
    const error = await failureOf(async () => {
      for await (const _ of store.listDocuments({ pageSize: hostile() })) break;
    });
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('reports a null-prototype batchSize as VALIDATION', async () => {
    const { store } = scriptedStore({}, { candidates: 3 });
    const error = await failureOf(async () => store.delete({ ids: ['a'], batchSize: hostile() }));
    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('reports a null-prototype maxConcurrentBatchCalls as VALIDATION', () => {
    expect(() => scriptedStore({ maxConcurrentBatchCalls: hostile() })).toThrow(
      /maxConcurrentBatchCalls/,
    );
  });
});
