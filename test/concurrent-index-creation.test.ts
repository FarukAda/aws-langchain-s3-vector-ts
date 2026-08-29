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
  indexFixture,
  mockIndexNotFound,
  sendOptionsOf,
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
      .resolves({ index: indexFixture(indexFixture({ dimension: 5, distanceMetric: 'cosine' })) });
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
      return { index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })) };
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
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
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
      return { index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })) };
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
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
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

    // resultB.status === 'fulfilled' alone doesn't actually prove B was
    // unaffected by A's abort — aws-sdk-client-mock's callsFake never
    // honors abortSignal at all, so B would fulfill even without the fix
    // this test exists to cover. Assert the two properties that DO
    // distinguish the fix: A's rejection carries the coded ABORTED error
    // (not, say, a generic "not found" leaking through), and the shared
    // memo's own GetIndex call was never given anyone's signal (proving
    // it's not tied to caller A's specifically, which is what would let
    // A's abort reach — and cancel — the AWS call B also depends on).
    const errorA = await writeA.catch((e: unknown) => e);
    expect((errorA as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(sendOptionsOf(mock.commandCalls(GetIndexCommand)[0]!)).toEqual({
      abortSignal: undefined,
    });
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

  it('makes zero AWS calls when addVectors is called with an already-aborted signal and no cached index info', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    const controller = new AbortController();
    controller.abort();

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
        ids: ['id-1'],
        signal: controller.signal,
      })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });
});

// Unlike the "index-validation cache — concurrency" tests above (which race
// deleteAll against a write still waiting on GetIndex/CreateIndex — this
// library's own local cache), these race deleteAll against a write that has
// *already passed* local validation and is inside its actual PutVectors
// network call — the interleaving the README calls out as "not
// coordinated." A mocked client can't prove what AWS itself does with an
// orphaned PutVectors call, but it can prove this library's own state
// machine doesn't hang, crash, or resurrect a cleared cache under either
// possible outcome.
describe('delete({deleteAll: true}) racing an in-flight PutVectors call', () => {
  it('does not resurrect the cleared cache when a racing PutVectors call resolves after the delete', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    // Warm the index-validation cache first, so the next write skips
    // GetIndex entirely and goes straight to its PutVectors call.
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['id-1'] });
    mock.resetHistory();

    let releasePutVectors!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePutVectors = resolve;
    });
    mock.on(PutVectorsCommand).callsFake(async () => {
      await gate;
      return {};
    });

    const writePromise = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'b' })], {
      ids: ['id-2'],
    });
    // Let the write skip GetIndex (cache is warm) and reach its gated
    // PutVectors call, then delete the whole index while that call is
    // still in flight.
    await Promise.resolve();
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
    await store.delete({ deleteAll: true });
    releasePutVectors();
    await writePromise;

    // The write's PutVectors resolved *after* the delete already cleared
    // the cache — that stale success must not resurrect it. A third write
    // must re-validate from scratch.
    mock.resetHistory();
    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'c' })], { ids: ['id-3'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('surfaces a clean coded error, not a hang, when a racing PutVectors call fails against the deleted index', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['id-1'] });
    mock.resetHistory();

    let rejectPutVectors!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => {
      rejectPutVectors = reject;
    });
    mock.on(PutVectorsCommand).callsFake(async () => {
      await gate;
    });

    const writePromise = store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'b' })], {
      ids: ['id-2'],
    });
    await Promise.resolve();
    await store.delete({ deleteAll: true });
    rejectPutVectors(
      Object.assign(new Error('The vector index does not exist'), { name: 'NotFoundException' }),
    );

    const error = await writePromise.catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { context: { writtenIds: string[] } }).context.writtenIds).toEqual([]);
  });
});
