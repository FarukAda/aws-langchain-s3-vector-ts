import { DeleteIndexCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.delete', () => {
  it('deletes entire index when no IDs provided', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteIndexCommand).resolves({});

    await store.delete();

    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
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
});
