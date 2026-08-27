import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  mockIndexNotFound,
} from './helpers.js';

describe('AmazonS3Vectors concurrent index creation', () => {
  it('only calls CreateIndex once when two addDocuments calls race on a new index', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    let getIndexCalls = 0;
    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).callsFake(async () => {
      getIndexCalls += 1;
      throw notFoundError;
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await Promise.all([
      store.addDocuments([new Document({ pageContent: 'a' })], { ids: ['id-a'] }),
      store.addDocuments([new Document({ pageContent: 'b' })], { ids: ['id-b'] }),
    ]);

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
    expect(getIndexCalls).toBe(1);
  });

  it('tolerates a ConflictException from CreateIndex as a benign cross-process race', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);
    const conflictError = Object.assign(new Error('already exists'), { name: 'ConflictException' });
    mock.on(CreateIndexCommand).rejects(conflictError);
    mock.on(PutVectorsCommand).resolves({});

    const ids = await store.addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] });
    expect(ids).toEqual(['id-1']);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it("re-fetches and validates against the winning process's actual committed index after a ConflictException", async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    // First GetIndex: not found (so we attempt to create). After our
    // CreateIndex loses to a ConflictException, the second GetIndex call
    // reveals what the winning process actually committed — a different
    // dimension than our own vector.
    const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
    mock
      .on(GetIndexCommand)
      .rejectsOnce(notFoundError)
      .resolves({ index: { indexName: 'test-index', dimension: 5, distanceMetric: 'cosine' } });
    const conflictError = Object.assign(new Error('already exists'), { name: 'ConflictException' });
    mock.on(CreateIndexCommand).rejects(conflictError);

    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('dimension 5');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('still surfaces a non-conflict CreateIndex failure', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);
    const deniedError = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    mock.on(CreateIndexCommand).rejects(deniedError);

    await expect(
      store.addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-1'] }),
    ).rejects.toThrow('denied');
  });
});

describe('index-validation cache — concurrency', () => {
  it('does not let a write in flight during a deleteAll resurrect the cleared cache', async () => {
    const { store, mock } = createTestStore();
    let releaseGetIndex!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGetIndex = resolve;
    });
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      return { index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' } };
    });
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    const writePromise = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
      ids: ['id-1'],
    });
    // Let the write reach and start waiting on GetIndex, then delete the
    // whole index while it's still in flight.
    await Promise.resolve();
    await store.delete({ deleteAll: true });
    releaseGetIndex();
    await writePromise;

    // The delete happened *during* the write's GetIndex call — the write's
    // eventual (stale, pre-delete) result must not resurrect the cache the
    // delete just cleared. A second write must re-validate, not silently
    // reuse a cache entry for an index that was deleted mid-first-write.
    mock.resetHistory();
    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'y' })], { ids: ['id-2'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('does not let a write in flight during a deleteAll resurrect the cleared cache when createIndexIfNotExist is false', async () => {
    const { store, mock } = createTestStore({ createIndexIfNotExist: false });
    let releaseGetIndex!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGetIndex = resolve;
    });
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      return { index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' } };
    });
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    // createIndexIfNotExist: false skips the shared _ensureIndexExists
    // memo entirely and calls _getIndex directly — this exercises the
    // epoch guard in _validateBeforeWrite's *other* branch.
    const writePromise = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
      ids: ['id-1'],
    });
    await Promise.resolve();
    await store.delete({ deleteAll: true });
    releaseGetIndex();
    await writePromise;

    mock.resetHistory();
    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'y' })], { ids: ['id-2'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it("one caller's abort does not cancel a sibling caller's write sharing the same index-creation memo", async () => {
    const { store, mock } = createTestStore();
    let releaseGetIndex!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGetIndex = resolve;
    });
    const notFound = Object.assign(new Error('not found'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      throw notFound;
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    const controllerA = new AbortController();
    const writeA = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], {
      ids: ['id-a'],
      signal: controllerA.signal,
    });
    await Promise.resolve();
    const writeB = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'b' })], {
      ids: ['id-b'],
    });
    await Promise.resolve();

    controllerA.abort();
    releaseGetIndex();

    const [resultA, resultB] = await Promise.allSettled([writeA, writeB]);
    expect(resultA.status).toBe('rejected');
    expect(resultB.status).toBe('fulfilled');
  });

  it("a caller's signal that never fires still sees a genuine index-creation failure surface normally, not swallowed or misreported as ABORTED", async () => {
    const { store, mock } = createTestStore();
    mockIndexNotFound(mock);
    const deniedError = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    mock.on(CreateIndexCommand).rejects(deniedError);

    const controller = new AbortController();
    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
        ids: ['id-1'],
        signal: controller.signal,
      })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
    expect((error as Error).message).toContain('denied');
  });
});
