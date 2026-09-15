import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3VectorsRetriever } from '../src/retriever.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore, sendOptionsOf } from './helpers.js';

/**
 * One test per domain cell of `AmazonS3VectorsRetriever`
 * (docs/CONTRACTS-DRAFT.md, "Cancellation"). Core's `BaseRetriever.invoke`
 * never passes the config to `_getRelevantDocuments`
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
