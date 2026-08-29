import {
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  GetVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  mockExistingIndex,
  sendOptionsOf,
} from './helpers.js';

describe('AmazonS3Vectors AbortSignal — forwarded to every AWS call', () => {
  it('forwards signal to PutVectors via addVectors', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const controller = new AbortController();

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
      ids: ['id-1'],
      signal: controller.signal,
    });

    expect(sendOptionsOf(mock.commandCalls(PutVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to PutVectors but not the shared index calls, via addDocuments', async () => {
    const { store, mock } = createTestStore();
    const notFound = Object.assign(new Error('not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFound);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});
    const controller = new AbortController();

    await store.addDocuments([new Document({ pageContent: 'x' })], {
      ids: ['id-1'],
      signal: controller.signal,
    });

    expect(sendOptionsOf(mock.commandCalls(GetIndexCommand)[0]!)).toEqual({
      abortSignal: undefined,
    });
    // CreateIndex takes no signal option at all: index creation is shared
    // across concurrent writers via _ensureIndexExists's memo, so no single
    // caller may cancel it out from under the others. It previously received
    // a literal `undefined` through a parameter no caller ever populated.
    expect(sendOptionsOf(mock.commandCalls(CreateIndexCommand)[0]!)).toBeUndefined();
    expect(sendOptionsOf(mock.commandCalls(PutVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to DeleteVectors via delete({ids})', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    mock.on(DeleteVectorsCommand).resolves({});
    const controller = new AbortController();

    await store.delete({ ids: ['id-1'], signal: controller.signal });

    expect(sendOptionsOf(mock.commandCalls(DeleteVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to DeleteIndex via delete({deleteAll: true})', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    mock.on(DeleteIndexCommand).resolves({});
    const controller = new AbortController();

    await store.delete({ deleteAll: true, signal: controller.signal });

    expect(sendOptionsOf(mock.commandCalls(DeleteIndexCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to GetVectors via getByIds', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves({ vectors: [{ key: 'id-1', metadata: {} }] });
    const controller = new AbortController();

    await store.getByIds(['id-1'], { signal: controller.signal });

    expect(sendOptionsOf(mock.commandCalls(GetVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to QueryVectors via similaritySearchVectorWithScore/similaritySearch/similaritySearchWithRelevanceScores', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const controller = new AbortController();

    await store.similaritySearchVectorWithScore([1, 2, 3], 4, undefined, controller.signal);
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });

    mock.resetHistory();
    await store.similaritySearch('q', 4, undefined, undefined, controller.signal);
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });

    mock.resetHistory();
    await store.similaritySearchWithRelevanceScores('q', 4, undefined, controller.signal);
    expect(sendOptionsOf(mock.commandCalls(QueryVectorsCommand)[0]!)).toEqual({
      abortSignal: controller.signal,
    });
  });
});

describe('AmazonS3Vectors AbortSignal — abort surfaces as a coded ABORTED error', () => {
  it('wraps an AbortError from PutVectors as ABORTED, not AWS_REQUEST_FAILED', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const abortError = Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    mock.on(PutVectorsCommand).rejects(abortError);

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
  });

  it('wraps an AbortError from GetIndex as ABORTED too (not routed through _send)', async () => {
    const { store, mock } = createTestStore();
    const abortError = Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    mock.on(GetIndexCommand).rejects(abortError);

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
  });
});

describe('AmazonS3Vectors AbortSignal — stops before starting more uncancellable work', () => {
  it('addDocuments does not embed further batches once the signal has fired mid-write', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const controller = new AbortController();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 1) controller.abort();
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const docs = Array.from({ length: 3 }, (_, i) => new Document({ pageContent: `d-${i}` }));

    const error = await store
      .addDocuments(docs, { batchSize: 1, signal: controller.signal })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    // Only the first batch (embedded before the signal fired) was ever
    // embedded — the check before the next group stopped batches 2/3 from
    // starting an expensive, uncancellable embedDocuments call.
    expect(embedCalls).toBe(1);
  });

  it('stops embedding the moment the signal fires inside a concurrent group, not at the group boundary', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    // 12 batches: batch 0 is embedded and put alone, then the remaining 11
    // are processed in groups of MAX_CONCURRENT_BATCH_CALLS (10) + 1. The
    // signal fires during the SECOND embed call — the first batch *inside*
    // the first group. Every later batch in that group is an expensive,
    // uncancellable, billable embedDocuments call for work nobody wants
    // anymore, so none of them may start.
    const controller = new AbortController();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 2) controller.abort();
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const docs = Array.from({ length: 12 }, (_, i) => new Document({ pageContent: `d-${i}` }));

    const error = await store
      .addDocuments(docs, { batchSize: 1, signal: controller.signal })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(embedCalls).toBe(2);
  });

  it('reports ids already written when the signal fires inside a concurrent group', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const controller = new AbortController();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 2) controller.abort();
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const docs = Array.from({ length: 12 }, (_, i) => new Document({ pageContent: `d-${i}` }));

    const error = await store
      .addDocuments(docs, {
        batchSize: 1,
        ids: docs.map((_, i) => `id-${i}`),
        signal: controller.signal,
      })
      .catch((e: unknown) => e);

    // Batch 0 was durably written before the abort — an aborted write must
    // still say what already landed, exactly like every other partial failure.
    expect((error as { context: { writtenIds?: string[] } }).context.writtenIds).toEqual(['id-0']);
  });

  it('does not embed the first batch at all when the signal is already aborted before the call', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const controller = new AbortController();
    controller.abort();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const error = await store
      .addDocuments([new Document({ pageContent: 'd-0' })], { signal: controller.signal })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(embedCalls).toBe(0);
  });
});

describe('similaritySearch / similaritySearchWithScore — a signal in the callbacks slot fails closed', () => {
  // The Callbacks slot is the 4th argument on both methods, per
  // @langchain/core's VectorStore signature, and this store accepts and
  // ignores it. A signal passed there was silently discarded: the search ran
  // to completion, having already spent a billable embedQuery call, and the
  // caller's cancellation never happened. Failing closed names the right slot
  // instead — this is exactly the mistake that silently defeated an earlier
  // regression test of our own.
  it.each([
    [
      'similaritySearch',
      (s: AmazonS3Vectors, sig: AbortSignal) => s.similaritySearch('q', 4, undefined, sig as never),
    ],
    [
      'similaritySearchWithScore',
      (s: AmazonS3Vectors, sig: AbortSignal) =>
        s.similaritySearchWithScore('q', 4, undefined, sig as never),
    ],
  ])('%s rejects an AbortSignal in the 4th slot before embedding', async (_label, call) => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    let embedQueryCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => texts.map(() => [1, 2, 3]),
      embedQuery: async () => {
        embedQueryCalls += 1;
        return [1, 2, 3];
      },
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const error = await call(store, new AbortController().signal).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('4th argument');
    expect((error as Error).message).toContain('5th');
    // Rejected before spending the billable, uncancellable embedding call.
    expect(embedQueryCalls).toBe(0);
  });

  it('still accepts a real Callbacks value in the 4th slot', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    await expect(store.similaritySearch('q', 4, undefined, [])).resolves.toEqual([]);
    await expect(store.similaritySearchWithScore('q', 4, undefined, [])).resolves.toEqual([]);
  });

  it('still honors a signal in the 5th slot', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const controller = new AbortController();
    controller.abort();

    const error = await store
      .similaritySearch('q', 4, undefined, undefined, controller.signal)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
  });
});

describe('similaritySearchWithRelevanceScores — signal in either slot', () => {
  // This method historically took the AbortSignal in the 4th slot, where
  // every other text-based method on this class takes Callbacks. A caller
  // following the house pattern (query, k, filter, callbacks, signal) had
  // their signal silently dropped. Both call styles now work.
  it.each([
    ['4th slot (historical)', true],
    ['5th slot (house pattern)', false],
  ])('honors an already-aborted signal passed in the %s', async (_label, legacySlot) => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine', vectors: [] });

    const controller = new AbortController();
    controller.abort();

    const error = await (
      legacySlot
        ? store.similaritySearchWithRelevanceScores('q', 4, undefined, controller.signal)
        : store.similaritySearchWithRelevanceScores('q', 4, undefined, undefined, controller.signal)
    ).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('does not mistake a Callbacks array in the 4th slot for an AbortSignal', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine', vectors: [] });

    await expect(store.similaritySearchWithRelevanceScores('q', 4, undefined, [])).resolves.toEqual(
      [],
    );
  });
});
