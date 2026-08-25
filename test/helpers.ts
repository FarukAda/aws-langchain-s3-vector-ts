import {
  CreateIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { jest } from '@jest/globals';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

import { AmazonS3Vectors } from '../src/s3-vectors.js';

/** Shared bucket/index config used across unit tests that don't need a different one. */
export const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

/**
 * Create a mocked `S3VectorsClient` using aws-sdk-client-mock.
 *
 * The returned `client` is a real `S3VectorsClient` instance whose `send`
 * method is intercepted by the returned `mock` stub. Use
 * `mock.on(CommandClass).resolves(...)` / `.rejects(...)` to script
 * responses, and `mock.commandCalls(CommandClass)` to assert invocations.
 *
 * Always call `mock.reset()` in `beforeEach` to avoid cross-test leakage.
 */
export function createMockClient(): {
  client: S3VectorsClient;
  mock: AwsClientStub<S3VectorsClient>;
} {
  const client = new S3VectorsClient({ region: 'us-east-1' });
  const mock = mockClient(client);
  return { client, mock };
}

/**
 * Create a mock `EmbeddingsInterface` that returns deterministic vectors.
 *
 * @param dimension Length of each vector returned.
 */
export function createMockEmbeddings(dimension = 3): EmbeddingsInterface {
  return {
    embedDocuments: jest.fn(async (docs: string[]) =>
      docs.map((_, i) => Array.from({ length: dimension }, (__, d) => i + d * 0.1)),
    ),
    embedQuery: jest.fn(async () => Array.from({ length: dimension }, (_, d) => 99 + d * 0.1)),
  } as unknown as EmbeddingsInterface;
}

/**
 * Create a store wired to a mocked client with default embeddings and
 * `BASE_CONFIG` — the common case for tests that don't need a custom
 * embeddings dimension or config override.
 */
export function createTestStore(): {
  store: AmazonS3Vectors;
  client: S3VectorsClient;
  mock: AwsClientStub<S3VectorsClient>;
} {
  const { client, mock } = createMockClient();
  const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
  return { store, client, mock };
}

/** Configure `mock` so `GetIndexCommand` rejects as not-found. */
export function mockIndexNotFound(mock: AwsClientStub<S3VectorsClient>): void {
  const notFoundError = Object.assign(new Error('Not found'), { name: 'NotFoundException' });
  mock.on(GetIndexCommand).rejects(notFoundError);
}

/**
 * Configure `mock` for the common "index doesn't exist yet" scenario:
 * `GetIndexCommand` rejects as not-found, and both `CreateIndexCommand` and
 * `PutVectorsCommand` resolve — i.e. the index gets auto-created on write.
 */
export function mockIndexAutoCreated(mock: AwsClientStub<S3VectorsClient>): void {
  mockIndexNotFound(mock);
  mock.on(CreateIndexCommand).resolves({});
  mock.on(PutVectorsCommand).resolves({});
}

/**
 * Configure `mock` for the common "index already exists" scenario:
 * `GetIndexCommand` resolves with an existing index, and `PutVectorsCommand`
 * resolves.
 */
export function mockExistingIndex(mock: AwsClientStub<S3VectorsClient>): void {
  mock.on(GetIndexCommand).resolves({ index: { indexName: 'test-index' } });
  mock.on(PutVectorsCommand).resolves({});
}
