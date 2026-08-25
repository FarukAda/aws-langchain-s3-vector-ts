import {
  DeleteVectorsCommand,
  GetIndexCommand,
  GetVectorsCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors default batch boundaries', () => {
  it('splits addVectors into PutVectors batches of 200', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
    mock.on(PutVectorsCommand).resolves({});

    const count = 250;
    const vectors = Array.from({ length: count }, () => [1, 2, 3]);
    const docs = Array.from({ length: count }, (_, i) => new Document({ pageContent: `d-${i}` }));
    const ids = Array.from({ length: count }, (_, i) => `id-${i}`);

    await store.addVectors(vectors, docs, { ids });

    const calls = mock.commandCalls(PutVectorsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.vectors).toHaveLength(200);
    expect(calls[1]!.args[0].input.vectors).toHaveLength(50);
  });

  it('splits getByIds into GetVectors batches of 100', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetVectorsCommand).callsFake((input) => ({
      vectors: (input.keys ?? []).map((k: string) => ({ key: k, metadata: { _page_content: k } })),
    }));

    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const docs = await store.getByIds(ids);

    expect(docs).toHaveLength(250);
    expect(docs[0]!.id).toBe('id-0');
    expect(docs[249]!.id).toBe('id-249');
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(3);
  });

  it('splits delete into DeleteVectors batches of 500', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mock.on(DeleteVectorsCommand).resolves({});

    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    await store.delete({ ids });

    const calls = mock.commandCalls(DeleteVectorsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.keys).toHaveLength(500);
    expect(calls[1]!.args[0].input.keys).toHaveLength(1);
  });
});

describe('AmazonS3Vectors rejects an invalid batchSize', () => {
  it('addVectors throws for batchSize 0', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { batchSize: 0 }),
    ).rejects.toThrow('batchSize must be a positive integer');
  });

  it('addVectors throws for a non-integer batchSize', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await expect(
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { batchSize: 1.5 }),
    ).rejects.toThrow('batchSize must be a positive integer');
  });

  it('addDocuments throws for a negative batchSize', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await expect(
      store.addDocuments([new Document({ pageContent: 'x' })], { batchSize: -1 }),
    ).rejects.toThrow('batchSize must be a positive integer');
  });

  it('delete throws for batchSize 0', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    await expect(store.delete({ ids: ['a'], batchSize: 0 })).rejects.toThrow(
      'batchSize must be a positive integer',
    );
  });

  it('getByIds throws for batchSize 0', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    await expect(store.getByIds(['a'], { batchSize: 0 })).rejects.toThrow(
      'batchSize must be a positive integer',
    );
  });
});

describe('AmazonS3Vectors.delete runs batches concurrently', () => {
  it('starts every DeleteVectors batch before waiting for any of them to settle', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const started: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    mock.on(DeleteVectorsCommand).callsFake(async (input) => {
      const key = input.keys?.[0];
      started.push(`start:${key}`);
      if (key === 'id-0') {
        await firstGate; // deliberately blocks the first batch until released below
      }
      return {};
    });

    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const deletePromise = store.delete({ ids });

    // Let the event loop tick so every dispatched batch has a chance to start.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Sequential await-in-loop code could only have started the first batch by
    // now (it's still blocked on firstGate, so batch 2/3 would never have been
    // dispatched). A concurrent implementation starts all three up front.
    expect(started).toEqual(['start:id-0', 'start:id-500', 'start:id-1000']);

    resolveFirst?.();
    await deletePromise;
  });
});

describe('AmazonS3Vectors.delete bounds concurrent batch calls', () => {
  it('never has more than 10 DeleteVectors calls in flight at once', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    let inFlight = 0;
    let maxInFlight = 0;
    mock.on(DeleteVectorsCommand).callsFake(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return {};
    });

    // 25 batches of 1 id each (batchSize 1) — well over the concurrency cap.
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    await store.delete({ ids, batchSize: 1 });

    expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(1); // still genuinely concurrent, not accidentally serialized
  });
});
