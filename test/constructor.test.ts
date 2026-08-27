import { describe, it, expect, jest } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
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

  it('builds its own client when the supplied client has no send method', () => {
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the no-send fallback
      client: {} as any,
      region: 'us-east-1',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
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
  it('rejects a duck-typed object with .send from a different client class, warns and falls back', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeClient = { send: async () => ({}) };

    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the wrong-class-client fallback
      client: fakeClient as any,
      region: 'us-east-1',
    });

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('not an instance of S3VectorsClient');
    warnSpy.mockRestore();
  });

  it('does not warn when a real S3VectorsClient is passed', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockClient();

    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn when no client is passed', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, region: 'us-east-1' });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
