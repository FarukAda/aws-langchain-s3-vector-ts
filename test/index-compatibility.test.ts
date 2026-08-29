import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  mockIndexNotFound,
} from './helpers.js';

describe('AmazonS3Vectors index compatibility validation', () => {
  it('rejects a write when the existing index has a different dimension', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 5, distanceMetric: 'cosine' },
    });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('dimension 5');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a write when the existing index uses a different distance metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      distanceMetric: 'cosine',
    });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'euclidean' },
    });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('euclidean');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('allows a write when the existing index matches dimension and metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] });

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('validates each concurrent caller against its own vector, not a shared verdict', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(GetIndexCommand).resolves({
      index: { indexName: 'test-index', dimension: 3, distanceMetric: 'cosine' },
    });
    mock.on(PutVectorsCommand).resolves({});

    const [matching, mismatched] = await Promise.allSettled([
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'ok' })], { ids: ['id-1'] }),
      store.addVectors([[1, 2, 3, 4, 5]], [new Document({ pageContent: 'bad' })], {
        ids: ['id-2'],
      }),
    ]);

    expect(matching.status).toBe('fulfilled');
    expect(mismatched.status).toBe('rejected');
    if (mismatched.status === 'rejected') {
      expect(isS3VectorsError(mismatched.reason)).toBe(true);
      expect((mismatched.reason as { code: S3VectorsErrorCode }).code).toBe(
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
      );
      // Must describe the rejected caller's own dimension (5), never the
      // concurrently-validated caller's dimension (3) — a shared verdict
      // would either let this one through or blame the wrong vector.
      expect((mismatched.reason as Error).message).toContain('dimension 5');
    }

    // Only the matching call's vector should ever have reached PutVectors.
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors?.[0]?.key).toBe('id-1');
    // The existence check itself is still shared — one GetIndex, not two.
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('validates each concurrent caller on the create path too, not just against a pre-existing index', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mockIndexNotFound(mock);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    const [matching, mismatched] = await Promise.allSettled([
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'ok' })], { ids: ['id-1'] }),
      store.addVectors([[1, 2, 3, 4, 5]], [new Document({ pageContent: 'bad' })], {
        ids: ['id-2'],
      }),
    ]);

    expect(matching.status).toBe('fulfilled');
    expect(mismatched.status).toBe('rejected');
    if (mismatched.status === 'rejected') {
      expect(isS3VectorsError(mismatched.reason)).toBe(true);
      expect((mismatched.reason as { code: S3VectorsErrorCode }).code).toBe(
        S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
      );
      expect((mismatched.reason as Error).message).toContain('dimension 5');
    }

    // The index gets created once, using whichever caller's vector won the
    // race (here, the 3-dimensional one) — and every caller, including
    // ones that lost the creation race, is validated against that result.
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)[0]!.args[0].input.dimension).toBe(3);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors?.[0]?.key).toBe('id-1');
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
        'Cannot determine vector dimension from empty batch',
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

describe('_getIndex — malformed GetIndex response', () => {
  it('throws a coded AWS_INVALID_RESPONSE error instead of a raw TypeError when index is missing', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({});

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
  });

  it('throws a coded AWS_INVALID_RESPONSE error when index is present but dimension/distanceMetric are missing', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: {} });

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
  });
});

describe('_getIndex — a literal null index', () => {
  // `index === undefined` was false for a literal null, so evaluation fell
  // through to `index.dimension` and threw a TypeError that got wrapped as
  // AWS_REQUEST_FAILED with raw internal text ("Cannot read properties of
  // null") instead of this library's own diagnosis.
  it('throws AWS_INVALID_RESPONSE, not AWS_REQUEST_FAILED, when index is null', async () => {
    const { store, mock } = createTestStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- malformed response by construction
    mock.on(GetIndexCommand).resolves({ index: null } as any);

    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { ids: ['id-1'] })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect((error as Error).message).not.toContain('Cannot read properties');
  });
});
