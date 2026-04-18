import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { jest } from '@jest/globals';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

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
