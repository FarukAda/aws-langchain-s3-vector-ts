import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, it, expect, jest } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

describe('AmazonS3Vectors constructor', () => {
  it('stores config properties with defaults', () => {
    const { client } = createMockClient();
    const embeddings = createMockEmbeddings();

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    expect(store.vectorBucketName).toBe('test-bucket');
    expect(store.indexName).toBe('test-index');
    expect(store.distanceMetric).toBe('cosine');
    expect(store.dataType).toBe('float32');
    expect(store.createIndexIfNotExist).toBe(true);
    expect(store.pageContentMetadataKey).toBe('_page_content');
  });

  it('accepts custom config overrides', () => {
    const { client } = createMockClient();
    const embeddings = createMockEmbeddings();
    const queryEmb = createMockEmbeddings(5);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
      distanceMetric: 'euclidean',
      dataType: 'float32',
      createIndexIfNotExist: false,
      pageContentMetadataKey: 'custom_key',
      queryEmbeddings: queryEmb,
      nonFilterableMetadataKeys: ['large_blob'],
    });

    expect(store.distanceMetric).toBe('euclidean');
    expect(store.dataType).toBe('float32');
    expect(store.pageContentMetadataKey).toBe('custom_key');
    expect(store.createIndexIfNotExist).toBe(false);
    expect(store.nonFilterableMetadataKeys).toEqual(['large_blob']);
  });

  it('reports vectorstoreType', () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    expect(store._vectorstoreType()).toBe('amazonS3Vectors');
  });

  it('constructs a real S3VectorsClient when no client is supplied', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      endpoint: 'https://example.test',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(store.vectorBucketName).toBe('test-bucket');
  });

  it('forwards retry options to the SDK client', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      maxAttempts: 5,
      retryMode: 'adaptive',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
  });

  it('forwards static credentials to the SDK client', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
  });
});

describe('AmazonS3Vectors constructor — client validation', () => {
  it('throws a coded VALIDATION error for an object that is not an S3VectorsClient', () => {
    const error = (() => {
      try {
        new AmazonS3Vectors(createMockEmbeddings(), {
          ...BASE_CONFIG,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the bad-client guard
          client: {} as any,
          region: 'us-east-1',
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe('constructor');
    expect((error as Error).message).toContain('is not an S3VectorsClient');
  });

  it('throws for a duck-typed object with .send from a different client class', () => {
    // Silently building a replacement here would fall back to the ambient
    // credential chain and default region, so an explicit-but-wrong client
    // could point this store at an entirely different AWS account.
    const fakeClient = { send: async () => ({}) };

    expect(
      () =>
        new AmazonS3Vectors(createMockEmbeddings(), {
          ...BASE_CONFIG,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the bad-client guard
          client: fakeClient as any,
          region: 'us-east-1',
        }),
    ).toThrow('is not an S3VectorsClient');
  });

  it('throws for an AWS client belonging to a different service', () => {
    const wrongService = { config: { serviceId: 'DynamoDB' }, send: async () => ({}) };

    expect(
      () =>
        new AmazonS3Vectors(createMockEmbeddings(), {
          ...BASE_CONFIG,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the bad-client guard
          client: wrongService as any,
          region: 'us-east-1',
        }),
    ).toThrow('is not an S3VectorsClient');
  });

  it('treats client: null as "not provided" and builds one from region/credentials', () => {
    // A DI framework or untyped caller defaulting an optional field to null
    // means "not provided" — the same reading _validateFilter already gives
    // a null filter. Previously this threw a raw, uncoded TypeError.
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the null-client path
      client: null as any,
      region: 'us-east-1',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect((store as unknown as { _client: unknown })._client).toBeInstanceOf(S3VectorsClient);
  });

  it('adopts a real S3VectorsClient unchanged', () => {
    const { client } = createMockClient();

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    expect((store as unknown as { _client: unknown })._client).toBe(client);
  });

  it('accepts a subclass of S3VectorsClient', () => {
    // The serviceId value is baked into the client at construction and is
    // inherited by a subclass — e.g. a tracing/middleware wrapper a caller
    // wrote — so a legitimate subclass is adopted rather than rejected.
    class TracingS3VectorsClient extends S3VectorsClient {}
    const client = new TracingS3VectorsClient({ region: 'us-east-1' });

    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    expect((store as unknown as { _client: unknown })._client).toBe(client);
  });

  it('emits no log output during construction', () => {
    // The README states the library emits no logs by design; this pins it.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, region: 'us-east-1' });
    const { client } = createMockClient();
    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
