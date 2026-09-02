import {
  CreateIndexCommand,
  GetIndexCommand,
  type Index,
  PutVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { jest } from '@jest/globals';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';

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
  };
}

/**
 * Create a store wired to a mocked client with default embeddings and
 * `BASE_CONFIG` — the common case for tests that don't need a custom
 * embeddings dimension. Pass `configOverrides` for tests that need e.g.
 * `pageContentMetadataKey: null` or a custom `relevanceScoreFn`.
 */
export function createTestStore(configOverrides: Partial<AmazonS3VectorsConfig> = {}): {
  store: AmazonS3Vectors;
  client: S3VectorsClient;
  mock: AwsClientStub<S3VectorsClient>;
  embeddings: EmbeddingsInterface;
} {
  const { client, mock } = createMockClient();
  const embeddings = createMockEmbeddings();
  const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, ...configOverrides, client });
  return { store, client, mock, embeddings };
}

/**
 * Build a complete `Index` for a mocked `GetIndex` response.
 *
 * The SDK's `Index` type requires more than the three fields this library
 * actually reads (`dimension`, `distanceMetric`, and `indexName` for
 * messages). Supplying only those left every mock a type error — invisible
 * to `npm test`, since ts-jest doesn't fail on them, and invisible to
 * `npm run typecheck`, whose tsconfig excludes `test/`. Filling the rest in
 * one place keeps the mocks both type-correct and closer to a real response.
 */
export function indexFixture(overrides: Partial<Index> = {}): Index {
  return {
    vectorBucketName: BASE_CONFIG.vectorBucketName,
    indexName: BASE_CONFIG.indexName,
    indexArn: `arn:aws:s3vectors:us-east-1:000000000000:bucket/${BASE_CONFIG.vectorBucketName}/index/${BASE_CONFIG.indexName}`,
    creationTime: new Date('2026-01-01T00:00:00.000Z'),
    dataType: 'float32',
    dimension: 3,
    distanceMetric: 'cosine',
    ...overrides,
  };
}

/**
 * A deliberately non-conforming `GetIndex` payload: an `index` is present but
 * carries none of the attributes this library requires.
 *
 * The cast is the point, not a convenience — `Index` demands fields that a
 * malformed response by definition doesn't have, so this is the one place
 * where sidestepping the type is the behaviour under test. Used to exercise
 * the `AWS_INVALID_RESPONSE` guard.
 */
export function malformedIndexFixture(): Index {
  return {} as Index;
}

/**
 * Read the `send(command, options)` options argument off a recorded call.
 *
 * `aws-sdk-client-mock` types a call's `args` as the 1-tuple `[Command]`,
 * but the runtime signature takes a second options argument — which is
 * exactly where this library threads `abortSignal`. Indexing `args[1]`
 * directly is therefore correct at runtime and a type error at compile
 * time; the cast lives here once, with the reason, instead of at every
 * assertion site.
 *
 * Returns the argument exactly as passed, `undefined` included. Do not
 * default it to `{}`: "no options argument at all" and "options carrying an
 * undefined signal" are different facts, and at least one test asserts on
 * precisely that difference (`CreateIndex` is called with no options, since
 * index creation is shared across concurrent writers and no single caller
 * may cancel it).
 */
export function sendOptionsOf(call: {
  args: readonly unknown[];
}): { abortSignal?: AbortSignal } | undefined {
  return call.args[1] as { abortSignal?: AbortSignal } | undefined;
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
  mock.on(GetIndexCommand).resolves({ index: indexFixture() });
  mock.on(PutVectorsCommand).resolves({});
}
