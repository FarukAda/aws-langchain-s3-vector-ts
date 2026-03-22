import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { jest } from '@jest/globals';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

/**
 * Create a mocked `S3VectorsClient` with its `send` method stubbed.
 *
 * Use `mockSend.mockResolvedValueOnce(...)` in each test to control
 * the responses returned for successive SDK calls.
 */
export function createMockClient(): {
  client: S3VectorsClient;
  mockSend: jest.Mock;
} {
  const mockSend = jest.fn();
  const client = { send: mockSend } as unknown as S3VectorsClient;
  return { client, mockSend };
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
