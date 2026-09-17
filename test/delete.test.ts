import {
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createTestStore, mockExistingIndex } from './helpers.js';

describe('AmazonS3Vectors.delete — an id S3 Vectors cannot decode (T3-15)', () => {
  it('is refused before any request, naming where the ids came from', async () => {
    const { store, mock } = createTestStore();
    const error = await store.delete({ ids: ['ok', 'k\ud800'] }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain(
      'Vector id at index 1 contains an unpaired UTF-16 surrogate',
    );
    expect((error as Error).message).toContain('Ids were taken from params.ids.');
    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(0);
  });
});

describe('AmazonS3Vectors.delete', () => {
  it('deletes the entire index through deleteIndex()', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteIndexCommand).resolves({});

    await store.deleteIndex();

    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(0);
  });

  it('names delete as the operation and DeleteVectors as the request on a DeleteVectors failure', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(DeleteVectorsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const error = await store.delete({ ids: ['a'] }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect((error as { context: Record<string, unknown> }).context).toMatchObject({
      operation: 'delete',
      awsCommand: 'DeleteVectors',
    });
  });

  it('requires ids, and says where destroying the index lives instead', async () => {
    const { store } = createTestStore();
    const error = await store
      .delete(undefined as unknown as { ids: string[] })
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'delete() requires `ids`. It removes vectors by id; to destroy the index itself, ' +
        'call deleteIndex().',
    );
  });

  it('never destroys the index, whatever it is given', async () => {
    const { store, mock } = createTestStore();
    await store.delete(undefined as unknown as { ids: string[] }).catch(() => undefined);
    await store.delete({} as unknown as { ids: string[] }).catch(() => undefined);
    // The one behaviour this method must never have.
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(0);
  });

  it('refuses the flag it used to accept, naming the method that replaced it', async () => {
    const { store, mock } = createTestStore();
    const error = await store
      .delete({ ids: ['a'], deleteAll: true } as unknown as { ids: string[] })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe(
      'delete() no longer takes `deleteAll`: it removes vectors by id and nothing else. ' +
        'To destroy the index — and with it its encryption configuration, tags and ' +
        'non-filterable-metadata configuration — call deleteIndex() instead.',
    );
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(0);
  });

  it('deletes vectors by IDs in batches', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteVectorsCommand).resolves({});

    const ids = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    await store.delete({ ids, batchSize: 2 });

    const deleteCalls = mock.commandCalls(DeleteVectorsCommand);
    // Should make 3 calls: [id-0, id-1], [id-2, id-3], [id-4]
    expect(deleteCalls).toHaveLength(3);
    expect(deleteCalls[0]!.args[0].input.keys).toEqual(['id-0', 'id-1']);
    expect(deleteCalls[2]!.args[0].input.keys).toEqual(['id-4']);
  });

  it('deletes by IDs using the default batch size', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteVectorsCommand).resolves({});

    await store.delete({ ids: ['a', 'b'] });

    const deleteCalls = mock.commandCalls(DeleteVectorsCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.args[0].input.keys).toEqual(['a', 'b']);
  });

  it('throws when both ids and deleteAll are provided', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    await expect(
      store.delete({ ids: ['a'], deleteAll: true } as unknown as { ids: string[] }),
    ).rejects.toThrow(/no longer takes/);
  });

  it('rejects a non-array ids argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
    const error = await store.delete({ ids: 'not-an-array' as any }).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('ids must be an array.');
  });
});

describe('AmazonS3Vectors.deleteIndex — idempotency', () => {
  const notFound = (): Error =>
    Object.assign(new Error('The specified index could not be found'), {
      name: 'NotFoundException',
    });

  it('resolves cleanly when the index is already gone', async () => {
    // Confirmed against real AWS: DeleteIndex on a missing index returns
    // NotFoundException — the same shape _getIndex already special-cases.
    // The realistic trigger is retrying a deleteIndex() after an ambiguous
    // network failure whose first attempt actually succeeded server-side.
    const { store, mock } = createTestStore();
    mock.on(DeleteIndexCommand).rejects(notFound());

    await expect(store.deleteIndex()).resolves.toBeUndefined();
  });

  it('clears the validated-index cache even when the index was already gone', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['a'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);

    mock.on(DeleteIndexCommand).rejects(notFound());
    await store.deleteIndex();

    // Cache cleared, so the next write re-fetches rather than validating
    // against index info the delete just revealed to be stale.
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'b' })], { ids: ['b'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('still surfaces a DeleteIndex failure that is not a not-found', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(DeleteIndexCommand)
      .rejects(Object.assign(new Error('nope'), { name: 'AccessDeniedException' }));

    const error = await store.deleteIndex().catch((e: unknown) => e);

    // Classified, not generic: an access failure is an IAM problem the caller
    // acts on differently from a transient one.
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });
});
