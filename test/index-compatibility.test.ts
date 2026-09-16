import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  indexFixture,
  mockIndexNotFound,
} from './helpers.js';

describe('AmazonS3Vectors index compatibility validation', () => {
  it('allows a write when the existing index matches dimension and metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it("does not blame one concurrent caller's empty batch on a different caller's valid one", async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    const [empty, valid] = await Promise.allSettled([
      store.addVectors([[]], [new Document({ pageContent: 'empty' })], { ids: ['id-1'] }),
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'valid' })], { ids: ['id-2'] }),
    ]);

    expect(empty.status).toBe('rejected');
    if (empty.status === 'rejected') {
      expect(isS3VectorsError(empty.reason)).toBe(true);
      expect((empty.reason as Error).message).toContain(
        'Every vector must have at least one dimension',
      );
      // Attributed to the caller whose batch was actually empty.
      expect((empty.reason as { context: { operation: string } }).context.operation).toBe(
        'addVectors',
      );
    }
    // The valid caller must not be rejected for the other caller's problem.
    expect(valid.status).toBe('fulfilled');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors?.[0]?.key).toBe('id-2');
  });
});

describe('_getIndex — a literal null index', () => {
  // `index === undefined` was false for a literal null, so evaluation fell
  // through to `index.dimension` and threw a TypeError that got wrapped as
  // AWS_REQUEST_FAILED with raw internal text ("Cannot read properties of
  // null") instead of this library's own diagnosis.
});

describe('later write batches — validation against the established index', () => {
  it('lets a later batch through to AWS when a concurrent deleteIndex() removed the index', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    mock.on(GetIndexCommand).resolves({
      index: indexFixture(indexFixture({ dimension: 3, distanceMetric: 'cosine' })),
    });
    mock.on(DeleteIndexCommand).resolves({});

    let puts = 0;
    mock.on(PutVectorsCommand).callsFake(async () => {
      puts += 1;
      // Between batch 0 and batch 1, wipe the index — clearing the
      // remembered existence the later-batch path would otherwise rely on.
      if (puts === 1) await store.deleteIndex();
      return {};
    });

    await store.addVectors(
      [
        [1, 2, 3],
        [1, 2, 3],
      ],
      [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
      { ids: ['a', 'b'], batchSize: 1 },
    );

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(2);
  });
});
