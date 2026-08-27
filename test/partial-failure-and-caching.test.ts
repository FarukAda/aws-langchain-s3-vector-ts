import {
  DeleteVectorsCommand,
  GetIndexCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  mockExistingIndex,
} from './helpers.js';

describe('AmazonS3Vectors partial-write failure reports writtenIds', () => {
  it('addVectors: attaches an empty writtenIds when the very first batch fails', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).rejects(new Error('boom'));
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { context: { writtenIds?: string[] } }).context.writtenIds).toEqual([]);
    expect((error as Error).message).not.toContain('durably written');
  });

  it('addVectors: a batch failing after the first succeeds reports every id written so far, including a group sibling that succeeded alongside the failure', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    // batchSize 1, 3 vectors -> batch 0 (first, serial) + batches 1 and 2 in
    // one concurrency group (2 <= MAX_CONCURRENT_BATCH_CALLS). id-2 fails,
    // id-3 succeeds alongside it in the same group.
    mock.on(PutVectorsCommand).callsFake((input) => {
      if (input.vectors?.[0]?.key === 'id-2') throw new Error('throttled');
      return {};
    });

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    const error = await store
      .addVectors(
        [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
        docs,
        { ids: ['id-1', 'id-2', 'id-3'], batchSize: 1 },
      )
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    const writtenIds = (error as { context: { writtenIds?: string[] } }).context.writtenIds;
    // id-1 (the serial first batch) and id-3 (the group sibling that
    // succeeded despite id-2 rejecting) — both confirmed written, neither
    // lost just because id-2 failed in the same concurrency group.
    expect(new Set(writtenIds)).toEqual(new Set(['id-1', 'id-3']));
    expect((error as Error).message).toContain('2 vector(s) were already durably written');
  });

  it('addVectors: when two batches in the same group both fail, reports the first failure and still counts every succeeding sibling', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    // batch 0 (serial) + batches for id-2..id-5 in one group. id-2 and id-3
    // both reject; id-4 and id-5 succeed alongside them in the same group.
    mock.on(PutVectorsCommand).callsFake((input) => {
      const key = input.vectors?.[0]?.key;
      if (key === 'id-2') throw new Error('first failure');
      if (key === 'id-3') throw new Error('second failure');
      return {};
    });

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
    const docs = ids.map((id) => new Document({ pageContent: id }));
    const vectors = ids.map((_, i) => [i, i + 1, i + 2]);

    const error = await store
      .addVectors(vectors, docs, { ids, batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    // The first rejection in array order wins — id-2's, not id-3's.
    expect((error as Error).message).toContain('first failure');
    expect((error as Error).message).not.toContain('second failure');
    const writtenIds = (error as { context: { writtenIds?: string[] } }).context.writtenIds;
    expect(new Set(writtenIds)).toEqual(new Set(['id-1', 'id-4', 'id-5']));
  });

  it('addDocuments: attaches an empty writtenIds when the very first batch fails to embed', async () => {
    const { client, mock } = createMockClient();
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async () => {
        throw new Error('embedding provider unavailable');
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    // UNEXPECTED_ERROR, not AWS_REQUEST_FAILED: the embeddings model threw
    // this, not AWS — no AWS call was ever made for this batch.
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect((error as { context: { writtenIds?: string[] } }).context.writtenIds).toEqual([]);
    expect((error as Error).message).toContain('embedding provider unavailable');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('addDocuments: an embedDocuments failure in a LATER group still reports ids written by earlier groups', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 2) throw new Error('rate limited');
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })];

    const error = await store
      .addDocuments(docs, { ids: ['id-1', 'id-2'], batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { context: { writtenIds?: string[] } }).context.writtenIds).toEqual(['id-1']);
  });

  it('addDocuments: a PutVectors failure in a later group reports ids from earlier groups plus any group sibling that succeeded', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).callsFake((input) => {
      if (input.vectors?.[0]?.key === 'id-2') throw new Error('throttled');
      return {};
    });

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    const error = await store
      .addDocuments(docs, { ids: ['id-1', 'id-2', 'id-3'], batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    const writtenIds = (error as { context: { writtenIds?: string[] } }).context.writtenIds;
    expect(new Set(writtenIds)).toEqual(new Set(['id-1', 'id-3']));
  });

  it('addDocuments: when two batches in the same group both fail, reports the first failure and still counts every succeeding sibling', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    mock.on(PutVectorsCommand).callsFake((input) => {
      const key = input.vectors?.[0]?.key;
      if (key === 'id-2') throw new Error('first failure');
      if (key === 'id-3') throw new Error('second failure');
      return {};
    });

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
    const docs = ids.map((id) => new Document({ pageContent: id }));

    const error = await store.addDocuments(docs, { ids, batchSize: 1 }).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as Error).message).toContain('first failure');
    expect((error as Error).message).not.toContain('second failure');
    const writtenIds = (error as { context: { writtenIds?: string[] } }).context.writtenIds;
    expect(new Set(writtenIds)).toEqual(new Set(['id-1', 'id-4', 'id-5']));
  });
});

describe('AmazonS3Vectors partial-delete failure reports deletedIds', () => {
  it('a batch failing after the first succeeds reports every id deleted so far, including a group sibling that succeeded alongside the failure', async () => {
    const { client, mock } = createMockClient();
    mock.on(DeleteVectorsCommand).callsFake((input) => {
      if (input.keys?.[0] === 'id-2') throw new Error('throttled');
      return {};
    });

    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const error = await store
      .delete({ ids: ['id-1', 'id-2', 'id-3'], batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    const deletedIds = (error as { context: { deletedIds?: string[] } }).context.deletedIds;
    expect(new Set(deletedIds)).toEqual(new Set(['id-1', 'id-3']));
    expect((error as Error).message).toContain('2 vector(s) were already durably deleted');
  });

  it('when two batches in the same group both fail, reports the first failure and still counts every succeeding sibling', async () => {
    const { client, mock } = createMockClient();
    mock.on(DeleteVectorsCommand).callsFake((input) => {
      const key = input.keys?.[0];
      if (key === 'id-2') throw new Error('first failure');
      if (key === 'id-3') throw new Error('second failure');
      return {};
    });

    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const error = await store
      .delete({ ids: ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'], batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as Error).message).toContain('first failure');
    expect((error as Error).message).not.toContain('second failure');
    const deletedIds = (error as { context: { deletedIds?: string[] } }).context.deletedIds;
    expect(new Set(deletedIds)).toEqual(new Set(['id-1', 'id-4', 'id-5']));
  });
});

describe('AmazonS3Vectors caches index info across sequential writes on the default config', () => {
  it('createIndexIfNotExist: true (default) only calls GetIndex once across 5 sequential addDocuments calls', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    for (let i = 0; i < 5; i++) {
      await store.addDocuments([new Document({ pageContent: `d${i}` })], { ids: [`id-${i}`] });
    }

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(5);
  });

  it('clears the cache on delete({ deleteAll: true }), so the next write re-fetches', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    await store.addDocuments([new Document({ pageContent: 'a' })], { ids: ['id-a'] });
    await store.delete({ deleteAll: true });
    await store.addDocuments([new Document({ pageContent: 'b' })], { ids: ['id-b'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });
});

describe('AmazonS3Vectors uses Document.id as a write-time fallback for ids', () => {
  it('addDocuments: uses each document.id when options.ids is omitted', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const docWithId = new Document({ pageContent: 'hello', id: 'stable-key-123', metadata: {} });
    await store.addDocuments([docWithId]);

    const call = mock.commandCalls(PutVectorsCommand)[0]!;
    expect(call.args[0].input.vectors?.[0]?.key).toBe('stable-key-123');
  });

  it('addDocuments: generates a fresh id only for documents that have none of their own', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const docs = [
      new Document({ pageContent: 'has-id', id: 'fixed-id', metadata: {} }),
      new Document({ pageContent: 'no-id', metadata: {} }),
    ];
    const ids = await store.addDocuments(docs);

    expect(ids[0]).toBe('fixed-id');
    expect(ids[1]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('addVectors: uses each document.id when options.ids is omitted', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const docWithId = new Document({ pageContent: 'hello', id: 'stable-key-456', metadata: {} });
    await store.addVectors([[1, 2, 3]], [docWithId]);

    const call = mock.commandCalls(PutVectorsCommand)[0]!;
    expect(call.args[0].input.vectors?.[0]?.key).toBe('stable-key-456');
  });

  it('an explicit options.ids still takes priority over document.id', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    const docWithId = new Document({ pageContent: 'hello', id: 'ignored-id', metadata: {} });
    await store.addDocuments([docWithId], { ids: ['explicit-id'] });

    const call = mock.commandCalls(PutVectorsCommand)[0]!;
    expect(call.args[0].input.vectors?.[0]?.key).toBe('explicit-id');
  });
});
