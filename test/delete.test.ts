import {
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createTestStore, mockExistingIndex } from './helpers.js';

describe('AmazonS3Vectors.delete', () => {
  it('deletes entire index when deleteAll is explicitly true', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteIndexCommand).resolves({});

    await store.delete({ deleteAll: true });

    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(0);
  });

  it('throws instead of deleting the index when neither ids nor deleteAll are given', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    await expect(store.delete()).rejects.toThrow(/deleteAll/);
    await expect(store.delete({})).rejects.toThrow(/deleteAll/);
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

    await expect(store.delete({ ids: ['a'], deleteAll: true })).rejects.toThrow(/cannot take both/);
  });

  it('rejects a non-array ids argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
    const error = await store.delete({ ids: 'not-an-array' as any }).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('ids must be an array.');
  });

  it('clears the cached index-compatibility check on deleteAll, so a later write re-validates instead of trusting a stale cache', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      createIndexIfNotExist: false,
    });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    mock.on(PutVectorsCommand).resolves({});

    // First write: validates against dimension 3, caches it.
    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);

    await store.delete({ deleteAll: true });

    // The index was deleted and (by whoever manages it externally, since
    // createIndexIfNotExist is false) recreated with a different
    // dimension. If the cache weren't cleared, this write would wrongly
    // succeed against the stale dimension-3 verdict instead of re-fetching.
    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 5, distanceMetric: 'cosine' },
    });

    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'y' })], { ids: ['id-2'] }),
    ).rejects.toThrow('dimension 5');

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });
});

describe('AmazonS3Vectors.delete({ deleteAll }) — idempotency', () => {
  const notFound = (): Error =>
    Object.assign(new Error('The specified index could not be found'), {
      name: 'NotFoundException',
    });

  it('resolves cleanly when the index is already gone', async () => {
    // Confirmed against real AWS: DeleteIndex on a missing index returns
    // NotFoundException — the same shape _getIndex already special-cases.
    // The realistic trigger is retrying a deleteAll after an ambiguous
    // network failure whose first attempt actually succeeded server-side.
    const { store, mock } = createTestStore();
    mock.on(DeleteIndexCommand).rejects(notFound());

    await expect(store.delete({ deleteAll: true })).resolves.toBeUndefined();
  });

  it('clears the validated-index cache even when the index was already gone', async () => {
    const { store, mock } = createTestStore();
    mockExistingIndex(mock);

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'a' })], { ids: ['a'] });
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);

    mock.on(DeleteIndexCommand).rejects(notFound());
    await store.delete({ deleteAll: true });

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

    const error = await store.delete({ deleteAll: true }).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
  });
});
