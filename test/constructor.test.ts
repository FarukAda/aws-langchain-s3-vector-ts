import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

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
});
