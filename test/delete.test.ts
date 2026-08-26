import { DeleteIndexCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { BASE_CONFIG, createMockClient } from './helpers.js';

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
});
