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

    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to GetIndex/CreateIndex/PutVectors via addDocuments', async () => {
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

    expect(mock.commandCalls(GetIndexCommand)[0]!.args[1]).toEqual({
      abortSignal: undefined,
    });
    expect(mock.commandCalls(CreateIndexCommand)[0]!.args[1]).toEqual({
      abortSignal: undefined,
    });
    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to DeleteVectors via delete({ids})', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    mock.on(DeleteVectorsCommand).resolves({});
    const controller = new AbortController();

    await store.delete({ ids: ['id-1'], signal: controller.signal });

    expect(mock.commandCalls(DeleteVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to DeleteIndex via delete({deleteAll: true})', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    mock.on(DeleteIndexCommand).resolves({});
    const controller = new AbortController();

    await store.delete({ deleteAll: true, signal: controller.signal });

    expect(mock.commandCalls(DeleteIndexCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to GetVectors via getByIds', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves({ vectors: [{ key: 'id-1', metadata: {} }] });
    const controller = new AbortController();

    await store.getByIds(['id-1'], { signal: controller.signal });

    expect(mock.commandCalls(GetVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('forwards signal to QueryVectors via similaritySearchVectorWithScore/similaritySearch/similaritySearchWithRelevanceScores', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const controller = new AbortController();

    await store.similaritySearchVectorWithScore([1, 2, 3], 4, undefined, controller.signal);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });

    mock.resetHistory();
    await store.similaritySearch('q', 4, undefined, undefined, controller.signal);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[1]).toEqual({
      abortSignal: controller.signal,
    });

    mock.resetHistory();
    await store.similaritySearchWithRelevanceScores('q', 4, undefined, controller.signal);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[1]).toEqual({
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
