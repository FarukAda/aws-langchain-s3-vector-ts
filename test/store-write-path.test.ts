import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore, indexFixture, mockExistingIndex } from './helpers.js';

/**
 * The write path's local checks and failure reporting.
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;
const ctxOf = (e: unknown): Record<string, unknown> =>
  (e as { context: Record<string, unknown> }).context;
const doc = (t: string): Document => new Document({ pageContent: t });

describe('the write path names the method the caller invoked, on a rejected batch', () => {
  it.each([
    [
      'addVectors',
      (store: ReturnType<typeof createTestStore>['store']) =>
        store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x', metadata: { bad: {} } })]),
    ],
    [
      'addDocuments',
      (store: ReturnType<typeof createTestStore>['store']) =>
        store.addDocuments([new Document({ pageContent: 'x', metadata: { bad: {} } })]),
    ],
  ])('%s', async (operation, run) => {
    // The rejection comes from metadata validation inside the batch write,
    // which both paths reach through the same helper — so the operation name
    // is the only thing that says which one the caller called.
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe(operation);
  });
});

describe('store — write-path local checks', () => {
  it('rejects a NaN component before any request, naming the vector and position', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([[1, Number.NaN, 3]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('NaN');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects an Infinity component before any request', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([[1, Number.POSITIVE_INFINITY, 3]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a zero vector on a cosine store, which AWS refuses for zero norm', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'cosine' });
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([[0, 0, 0]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('norm');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('accepts a zero vector on a euclidean store, because the evidence covers cosine only', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'euclidean' });
    mock.on(GetIndexCommand).resolves({ index: indexFixture({ distanceMetric: 'euclidean' }) });
    mock.on(PutVectorsCommand).resolves({});

    await expect(store.addVectors([[0, 0, 0]], [doc('x')], { ids: ['a'] })).resolves.toEqual(['a']);
  });

  it('rejects an over-long vector id before any request', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([[1, 2, 3]], [doc('x')], { ids: ['x'.repeat(1025)] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('1024');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a vector whose dimension exceeds what any index may have', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([Array.from({ length: 4097 }, () => 0.1)], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });
});

describe('store — failed writes are retryable without duplicating', () => {
  it('carries the full resolved id list alongside what already landed', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolvesOnce({}).rejects(awsError('ServiceUnavailableException'));

    const error = await store
      .addVectors(
        [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
        [doc('a'), doc('b'), doc('c')],
        { ids: ['a', 'b', 'c'], batchSize: 1 },
      )
      .catch((e: unknown) => e);

    expect(ctxOf(error)['writtenIds']).toEqual(['a']);
    // Without this, a retry of the whole call would mint fresh UUIDs for the
    // documents that already landed and duplicate them.
    expect(ctxOf(error)['attemptedIds']).toEqual(['a', 'b', 'c']);
  });

  it('carries the generated ids too, which a caller could not otherwise reconstruct', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).rejects(awsError('ServiceUnavailableException'));

    const error = await store.addVectors([[1, 2, 3]], [doc('a')], {}).catch((e: unknown) => e);

    const attempted = ctxOf(error)['attemptedIds'] as string[];
    expect(attempted).toHaveLength(1);
    expect(attempted[0]).toMatch(/^[0-9a-f]{32}$/);
  });
});
