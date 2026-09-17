import {
  GetIndexCommand,
  GetVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3VectorsRetriever } from '../src/retriever.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore, gate, indexFixture, sendOptionsOf } from './helpers.js';

/**
 * One test per domain cell of `AmazonS3VectorsRetriever`. Core's
 * `BaseRetriever.invoke` never passes the config to `_getRelevantDocuments`
 * (`@langchain/core@1.2.11` `dist/retrievers/index.js:81`, `:85`), so the two
 * signals have two different jobs: a retriever **field** signal reaches
 * `QueryVectors` and cancels it; a **config** signal ends the invocation only.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function retrieverStore() {
  const { store, mock, embeddings } = createTestStore();
  mock.on(QueryVectorsCommand).resolves({
    distanceMetric: 'cosine',
    vectors: [
      { key: 'a', distance: 0.1, metadata: { _page_content: 'alpha' } },
      { key: 'b', distance: 0.2, metadata: { _page_content: 'beta' } },
    ],
  });
  mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => ({
    vectors: input.keys.map((key) => ({
      key,
      data: { float32: [1, 0, 0] },
      metadata: { _page_content: key },
    })),
  }));
  return { store, mock, embeddings };
}

describe('asRetriever', () => {
  it('returns an AmazonS3VectorsRetriever, so the signal fields exist at all', () => {
    const { store } = retrieverStore();
    expect(store.asRetriever()).toBeInstanceOf(AmazonS3VectorsRetriever);
  });

  it('identifies itself by its own name rather than core’s, in the serialization id', () => {
    // `lc_name` is what core stamps into a serialized runnable's id
    // (`@langchain/core@1.2.11` `dist/load/serializable.js`), so a trace shows
    // which retriever actually ran.
    expect(AmazonS3VectorsRetriever.lc_name()).toBe('AmazonS3VectorsRetriever');
  });

  it('still accepts the plain numeric k form core documents', async () => {
    const { store } = retrieverStore();
    const retriever = store.asRetriever(1);
    expect(retriever.k).toBe(1);
    expect(await retriever.invoke('q')).toHaveLength(1);
  });

  it('carries the vector store type as a tag, as core does', () => {
    const { store } = retrieverStore();
    expect(store.asRetriever({ k: 2, tags: ['mine'] }).tags).toEqual(['mine', 'amazonS3Vectors']);
  });

  it('passes k and filter through to QueryVectors', async () => {
    const { store, mock } = retrieverStore();
    await store.asRetriever({ k: 2, filter: { tag: { $eq: 'x' } } }).invoke('q');
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({
      topK: 2,
      filter: { tag: { $eq: 'x' } },
    });
  });

  it('dispatches MMR when asked, including its searchKwargs', async () => {
    const { store, mock } = retrieverStore();
    await store
      .asRetriever({ k: 1, searchType: 'mmr', searchKwargs: { fetchK: 2, lambda: 0.5 } })
      .invoke('q');
    // fetchK is what MMR asks the service for, so it proves the kwargs arrived.
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({ topK: 2 });
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(1);
  });
});

describe('the field signal — asRetriever({ signal })', () => {
  it('reaches QueryVectors, so an abort cancels the AWS request itself', async () => {
    const { store, mock } = retrieverStore();
    const ac = new AbortController();
    await store.asRetriever({ k: 1, signal: ac.signal }).invoke('q');
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)?.abortSignal).toBe(ac.signal);
  });

  it('rejects before any request when it has already fired', async () => {
    const { store, mock, embeddings } = retrieverStore();
    const ac = new AbortController();
    ac.abort();
    const error = await store
      .asRetriever({ k: 1, signal: ac.signal })
      .invoke('q')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('reaches both calls MMR makes', async () => {
    const { store, mock } = retrieverStore();
    const ac = new AbortController();
    await store
      .asRetriever({ k: 1, searchType: 'mmr', searchKwargs: { fetchK: 2 }, signal: ac.signal })
      .invoke('q');
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)?.abortSignal).toBe(ac.signal);
    expect(sendOptionsOf(mock.commandCalls(GetVectorsCommand)[0]!)?.abortSignal).toBe(ac.signal);
  });
});

describe('the config signal — invoke(query, { signal })', () => {
  it('runs normally when no signal is given', async () => {
    const { store } = retrieverStore();
    expect(await store.asRetriever({ k: 2 }).invoke('q', {})).toHaveLength(2);
  });

  it('rejects before any embedding or request when it has already fired', async () => {
    const { store, mock, embeddings } = retrieverStore();
    const ac = new AbortController();
    ac.abort();
    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q', { signal: ac.signal })
      .catch((e: unknown) => e);
    // The cell that used to resolve with results after paying for both.
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('rejects when it fires mid-query rather than resolving with results', async () => {
    const { store, mock } = retrieverStore();
    const ac = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.on(QueryVectorsCommand).callsFake(async () => {
      ac.abort();
      await held;
      return { distanceMetric: 'cosine', vectors: [{ key: 'a', distance: 0.1, metadata: {} }] };
    });

    const settled = await store
      .asRetriever({ k: 1 })
      .invoke('q', { signal: ac.signal })
      .catch((e: unknown) => codeOf(e));
    release();
    expect(settled).toBe(S3VectorsErrorCode.ABORTED);
  });

  it('observes a failure arriving after the abort, so it is never an unhandled rejection', async () => {
    const { store, mock } = retrieverStore();
    const ac = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.on(QueryVectorsCommand).callsFake(async () => {
      ac.abort();
      await held;
      throw new Error('late failure');
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const settled = await store
      .asRetriever({ k: 1 })
      .invoke('q', { signal: ac.signal })
      .catch((e: unknown) => codeOf(e));
    release();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);

    expect(settled).toBe(S3VectorsErrorCode.ABORTED);
    expect(unhandled).toEqual([]);
  });

  it('does not hand core a legacy callbacks argument as a config', async () => {
    // Core's own `invoke` accepts a callbacks list in the config's place
    // (`@langchain/core@1.2.11` `dist/retrievers/index.js:82`, through
    // `parseCallbackConfigArg`); reading that config here must not lose it.
    const { store } = retrieverStore();
    const started: string[] = [];
    const handler = { handleRetrieverStart: (): void => void started.push('start') };
    await store.asRetriever({ k: 1 }).invoke('q', [handler] as never);
    expect(started).toEqual(['start']);
  });

  it('honours both signals at once, each doing its own job', async () => {
    const { store, mock } = retrieverStore();
    const field = new AbortController();
    const config = new AbortController();
    await store.asRetriever({ k: 1, signal: field.signal }).invoke('q', { signal: config.signal });
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)?.abortSignal).toBe(
      field.signal,
    );
  });
});

describe('a config timeout — invoke(query, { timeout })', () => {
  // Core turns a positive `timeout` into a signal in `ensureConfig`
  // (`@langchain/core@1.2.11` `dist/runnables/config.js:105-126`) but its
  // `BaseRetriever.invoke` never races it; this retriever does.
  it('ends an invocation that outlasts it, ABORTED with the TimeoutError as cause', async () => {
    const { store, mock } = retrieverStore();
    const release = gate();
    mock.on(QueryVectorsCommand).callsFake(async () => {
      await release.promise;
      return { distanceMetric: 'cosine', vectors: [] };
    });

    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q', { timeout: 20 })
      .catch((e: unknown) => e);
    release.open();

    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: { operation: string } }).context.operation).toBe(
      'retriever.invoke',
    );
    expect(((error as Error).cause as Error).name).toBe('TimeoutError');
  });

  it('lets an invocation that finishes in time resolve', async () => {
    const { store } = retrieverStore();
    expect(await store.asRetriever({ k: 2 }).invoke('q', { timeout: 500 })).toHaveLength(2);
  });

  it('refuses a non-positive one as core does, coded UNEXPECTED_ERROR', async () => {
    const { store, mock } = retrieverStore();
    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q', { timeout: 0 })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(((error as Error).cause as Error).message).toBe('Timeout must be a positive number');
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('a retriever is checked when it is built', () => {
  it('builds with valid fields, a fired field signal included — that is ABORTED when it runs', () => {
    const { store } = retrieverStore();
    const ac = new AbortController();
    ac.abort();
    expect(store.asRetriever({ k: 1, signal: ac.signal })).toBeInstanceOf(AmazonS3VectorsRetriever);
    expect(
      new AmazonS3VectorsRetriever({
        vectorStore: store,
        k: 2,
        searchType: 'mmr',
        searchKwargs: { fetchK: 5, lambda: 1 },
      }),
    ).toBeInstanceOf(AmazonS3VectorsRetriever);
  });

  it('refuses a field it could never search with, by the rule the search itself applies', () => {
    const { store } = retrieverStore();
    expect(() => store.asRetriever({ k: 10_001 })).toThrow("k (10001) exceeds AWS's topK limit");
    expect(() => new AmazonS3VectorsRetriever({ vectorStore: store, k: 1.5 })).toThrow(
      'k must be a positive integer',
    );
    expect(() =>
      store.asRetriever({ searchType: 'mmr', searchKwargs: { fetchK: 10_001 } }),
    ).toThrow('fetchK must be an integer between 1 and 10000');
    expect(() => store.asRetriever({ searchType: 'similarity_score_threshold' as never })).toThrow(
      `searchType must be 'similarity' or 'mmr' (received "similarity_score_threshold").`,
    );
    expect(() => store.asRetriever({ searchType: 7 as never })).toThrow(
      `searchType must be 'similarity' or 'mmr' (received 7).`,
    );
  });
});

describe('retriever.addDocuments', () => {
  it('writes through the store, options included, and returns its ids', async () => {
    const { store, mock } = retrieverStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    const ids = await store
      .asRetriever()
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['doc-1'] });
    expect(ids).toEqual(['doc-1']);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });
});

/**
 * Every option a retriever can be built with reaches the search.
 *
 * Each one is now spread in conditionally — present when given, absent rather
 * than `undefined` when not — because `@langchain/core` types them as optional
 * but not `undefined`-valued, so an explicit undefined is a type error under
 * `exactOptionalPropertyTypes`. That is two branches per option, and a test that
 * only ever omits them checks half of it.
 */
describe('a retriever carries the options it was built with', () => {
  it('threads the fields form through to the search, MMR included', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'k1', metadata: { _page_content: 'p' } }],
      distanceMetric: 'cosine',
    });
    mock.on(GetVectorsCommand).resolves({
      vectors: [
        { key: 'k1', data: { float32: [0.1, 0.2, 0.3] }, metadata: { _page_content: 'p' } },
      ],
    });

    const retriever = store.asRetriever({
      searchType: 'mmr',
      k: 1,
      filter: { topic: 'a' },
      searchKwargs: { fetchK: 5 },
      metadata: { tenant: 'acme' },
      verbose: false,
      callbacks: [],
      tags: ['mine'],
    });

    await retriever.invoke('q');

    const query = mock.commandCalls(QueryVectorsCommand)[0]?.args[0].input;
    expect(query?.filter).toEqual({ topic: 'a' });
    expect(query?.topK).toBe(5);
    expect(retriever.tags).toEqual(['mine', 'amazonS3Vectors']);
    expect(retriever.metadata).toEqual({ tenant: 'acme' });
  });

  it('threads the positional form through to the search', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'k1', metadata: { _page_content: 'p' }, distance: 0.2 }],
      distanceMetric: 'cosine',
    });

    const retriever = store.asRetriever(3, { topic: 'b' }, [], ['mine'], { tenant: 'acme' }, true);
    await retriever.invoke('q');

    const query = mock.commandCalls(QueryVectorsCommand)[0]?.args[0].input;
    expect(query?.filter).toEqual({ topic: 'b' });
    expect(query?.topK).toBe(3);
    expect(retriever.verbose).toBe(true);
  });
});
