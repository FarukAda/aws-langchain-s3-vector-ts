import {
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from '../src/utils.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

// ─── Utility tests ───────────────────────────────────────────────────────────

describe('Relevance score functions', () => {
  it('cosineRelevanceScoreFn converts distance to score', () => {
    expect(cosineRelevanceScoreFn(0)).toBe(1);
    expect(cosineRelevanceScoreFn(0.5)).toBe(0.5);
    expect(cosineRelevanceScoreFn(1)).toBe(0);
  });

  it('euclideanRelevanceScoreFn converts distance to score', () => {
    expect(euclideanRelevanceScoreFn(0)).toBe(1);
    expect(euclideanRelevanceScoreFn(Math.sqrt(4096))).toBeCloseTo(0);
  });
});

// ─── Constructor tests ───────────────────────────────────────────────────────

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

// ─── addVectors tests ────────────────────────────────────────────────────────

describe('AmazonS3Vectors.addVectors', () => {
  let store: AmazonS3Vectors;
  let mockSend: jest.Mock;

  beforeEach(() => {
    const mock = createMockClient();
    mockSend = mock.mockSend;
    store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client: mock.client,
    });
  });

  it('stores vectors with metadata and page_content', async () => {
    // GetIndex succeeds → index exists
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    // PutVectors succeeds
    mockSend.mockResolvedValueOnce({});

    const docs = [new Document({ pageContent: 'hello world', metadata: { genre: 'test' } })];
    const vectors = [[0.1, 0.2, 0.3]];

    const ids = await store.addVectors(vectors, docs, {
      ids: ['id-1'],
    });

    expect(ids).toEqual(['id-1']);

    // Verify PutVectorsCommand was called with correct payload
    const putCall = mockSend.mock.calls[1]![0]!;
    expect(putCall).toBeInstanceOf(PutVectorsCommand);
    expect(putCall.input.vectors[0].key).toBe('id-1');
    expect(putCall.input.vectors[0].data.float32).toEqual([0.1, 0.2, 0.3]);
    expect(putCall.input.vectors[0].metadata).toEqual({
      genre: 'test',
      _page_content: 'hello world',
    });
  });

  it('generates UUID IDs when none provided', async () => {
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    mockSend.mockResolvedValueOnce({});

    const docs = [new Document({ pageContent: 'doc1' })];
    const vectors = [[1, 2, 3]];

    const ids = await store.addVectors(vectors, docs);

    expect(ids).toHaveLength(1);
    // UUID without dashes = 32 hex characters
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('batches vectors correctly (batch size 2)', async () => {
    // GetIndex succeeds
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    // Two PutVectors calls expected
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    await store.addVectors(vectors, docs, { batchSize: 2 });

    // 1 GetIndex + 2 PutVectors
    expect(mockSend).toHaveBeenCalledTimes(3);

    const put1 = mockSend.mock.calls[1]![0]!;
    const put2 = mockSend.mock.calls[2]![0]!;
    expect(put1).toBeInstanceOf(PutVectorsCommand);
    expect(put2).toBeInstanceOf(PutVectorsCommand);
    expect(put1.input.vectors).toHaveLength(2);
    expect(put2.input.vectors).toHaveLength(1);
  });

  it('auto-creates index when it does not exist', async () => {
    // GetIndex returns NotFoundException
    const notFoundError = new Error('Not found');
    (notFoundError as unknown as { name: string }).name = 'NotFoundException';
    mockSend.mockRejectedValueOnce(notFoundError);
    // CreateIndex succeeds
    mockSend.mockResolvedValueOnce({ indexArn: 'arn:test' });
    // PutVectors succeeds
    mockSend.mockResolvedValueOnce({});

    const docs = [new Document({ pageContent: 'first' })];
    const vectors = [[1, 2, 3]];

    await store.addVectors(vectors, docs, { ids: ['id-1'] });

    expect(mockSend).toHaveBeenCalledTimes(3);
    const createCall = mockSend.mock.calls[1]![0]!;
    expect(createCall).toBeInstanceOf(CreateIndexCommand);
    expect(createCall.input.dimension).toBe(3);
    expect(createCall.input.distanceMetric).toBe('cosine');
    expect(createCall.input.dataType).toBe('float32');
  });

  it('skips index creation when index exists', async () => {
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    mockSend.mockResolvedValueOnce({});

    const docs = [new Document({ pageContent: 'exists' })];
    const vectors = [[1, 2, 3]];

    await store.addVectors(vectors, docs, { ids: ['id-1'] });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0]![0]).toBeInstanceOf(GetIndexCommand);
    expect(mockSend.mock.calls[1]![0]).toBeInstanceOf(PutVectorsCommand);
  });

  it('throws when vector and document counts mismatch', async () => {
    await expect(
      store.addVectors(
        [[1, 2]],
        [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
      ),
    ).rejects.toThrow('must match');
  });

  it('returns empty array for empty input', async () => {
    const ids = await store.addVectors([], []);
    expect(ids).toEqual([]);
  });
});

// ─── addDocuments tests ──────────────────────────────────────────────────────

describe('AmazonS3Vectors.addDocuments', () => {
  it('embeds documents and calls addVectors', async () => {
    const { client, mockSend } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    mockSend.mockResolvedValueOnce({});

    const docs = [new Document({ pageContent: 'hello' })];
    const ids = await store.addDocuments(docs, { ids: ['doc-1'] });

    expect(ids).toEqual(['doc-1']);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello']);
  });
});

// ─── Similarity search tests ─────────────────────────────────────────────────

describe('AmazonS3Vectors.similaritySearchVectorWithScore', () => {
  it('returns scored documents from QueryVectors', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'hello', genre: 'test' }, distance: 0.1 },
        { key: 'id-2', metadata: { _page_content: 'world', genre: 'test' }, distance: 0.5 },
      ],
    });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 2);

    expect(results).toHaveLength(2);

    const [doc1, score1] = results[0]!;
    expect(doc1.pageContent).toBe('hello');
    expect(doc1.id).toBe('id-1');
    expect(doc1.metadata).toEqual({ genre: 'test' });
    expect(score1).toBe(0.1);

    const queryCall = mockSend.mock.calls[0]![0]!;
    expect(queryCall).toBeInstanceOf(QueryVectorsCommand);
    expect(queryCall.input.returnDistance).toBe(true);
    expect(queryCall.input.returnMetadata).toBe(true);
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore', () => {
  it('embeds query and returns scored results', async () => {
    const { client, mockSend } = createMockClient();
    const embeddings = createMockEmbeddings();
    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'result' }, distance: 0.2 }],
    });

    const results = await store.similaritySearchWithScore('query text', 1);

    expect(results).toHaveLength(1);
    expect(results[0]![0].pageContent).toBe('result');
    expect(results[0]![1]).toBe(0.2);
    expect(embeddings.embedQuery).toHaveBeenCalledWith('query text');
  });
});

describe('AmazonS3Vectors.similaritySearchByVector', () => {
  it('returns documents without scores', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'doc' } }],
    });

    const results = await store.similaritySearchByVector([1, 2, 3], 1);

    expect(results).toHaveLength(1);
    expect(results[0]!.pageContent).toBe('doc');

    const queryCall = mockSend.mock.calls[0]![0]!;
    expect(queryCall).toBeInstanceOf(QueryVectorsCommand);
    expect(queryCall.input.returnDistance).toBe(false);
  });
});

// ─── Delete tests ────────────────────────────────────────────────────────────

describe('AmazonS3Vectors.delete', () => {
  it('deletes entire index when no IDs provided', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mockSend.mockResolvedValueOnce({});

    await store.delete();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]![0]).toBeInstanceOf(DeleteIndexCommand);
  });

  it('deletes vectors by IDs in batches', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    mockSend.mockResolvedValue({});

    const ids = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    await store.delete({ ids, batchSize: 2 });

    // Should make 3 calls: [id-0, id-1], [id-2, id-3], [id-4]
    expect(mockSend).toHaveBeenCalledTimes(3);
    for (const call of mockSend.mock.calls) {
      expect(call[0]).toBeInstanceOf(DeleteVectorsCommand);
    }
    expect(mockSend.mock.calls[0]![0].input.keys).toEqual(['id-0', 'id-1']);
    expect(mockSend.mock.calls[2]![0].input.keys).toEqual(['id-4']);
  });
});

// ─── getByIds tests ──────────────────────────────────────────────────────────

describe('AmazonS3Vectors.getByIds', () => {
  it('retrieves documents in input order', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [
        { key: 'id-2', metadata: { _page_content: 'second' } },
        { key: 'id-1', metadata: { _page_content: 'first' } },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-2']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('first');
    expect(docs[0]!.id).toBe('id-1');
    expect(docs[1]!.pageContent).toBe('second');
    expect(docs[1]!.id).toBe('id-2');
  });

  it('throws when an ID is not found', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({ vectors: [] });

    await expect(store.getByIds(['missing-id'])).rejects.toThrow(
      "Id 'missing-id' not found in vector store.",
    );
  });
});

// ─── Static factory tests ────────────────────────────────────────────────────

describe('AmazonS3Vectors.fromTexts', () => {
  it('creates instance, embeds, and stores texts', async () => {
    const { client, mockSend } = createMockClient();
    const embeddings = createMockEmbeddings();

    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    mockSend.mockResolvedValueOnce({});

    const store = await AmazonS3Vectors.fromTexts(
      ['hello', 'world'],
      [{ genre: 'a' }, { genre: 'b' }],
      embeddings,
      { ...BASE_CONFIG, client },
    );

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello', 'world']);
  });
});

// ─── _createDocument / page_content handling ─────────────────────────────────

describe('AmazonS3Vectors page_content handling', () => {
  it('extracts page_content from metadata key', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'the content', other: 'meta' }, distance: 0 },
      ],
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![0].pageContent).toBe('the content');
    expect(results[0]![0].metadata).toEqual({ other: 'meta' });
    expect(results[0]![0].metadata).not.toHaveProperty('_page_content');
  });

  it('returns empty page_content when pageContentMetadataKey is null', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      pageContentMetadataKey: null,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [{ key: 'id-1', metadata: { some_field: 'value' }, distance: 0 }],
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![0].pageContent).toBe('');
    expect(results[0]![0].metadata).toEqual({ some_field: 'value' });
  });
});

// ─── _selectRelevanceScoreFn tests ───────────────────────────────────────────

describe('AmazonS3Vectors._selectRelevanceScoreFn', () => {
  it('returns cosine fn by default', () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const fn = store._selectRelevanceScoreFn();
    expect(fn(0.3)).toBe(cosineRelevanceScoreFn(0.3));
  });

  it('returns euclidean fn for euclidean metric', () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      distanceMetric: 'euclidean',
    });
    const fn = store._selectRelevanceScoreFn();
    expect(fn(10)).toBe(euclideanRelevanceScoreFn(10));
  });

  it('returns custom fn when provided', () => {
    const { client } = createMockClient();
    const customFn = (d: number) => 42 - d;
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      relevanceScoreFn: customFn,
    });
    expect(store._selectRelevanceScoreFn()(1)).toBe(41);
  });
});

// ─── Auto-index creation with metadataConfiguration ──────────────────────────

describe('AmazonS3Vectors auto-index with nonFilterableMetadataKeys', () => {
  it('passes metadataConfiguration to CreateIndex', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      nonFilterableMetadataKeys: ['large_field'],
    });

    const notFoundError = new Error('Not found');
    (notFoundError as unknown as { name: string }).name = 'NotFoundException';
    mockSend.mockRejectedValueOnce(notFoundError);
    mockSend.mockResolvedValueOnce({ indexArn: 'arn:test' });
    mockSend.mockResolvedValueOnce({});

    await store.addVectors([[1, 2]], [new Document({ pageContent: 'test' })], { ids: ['id-1'] });

    const createCall = mockSend.mock.calls[1]![0]!;
    expect(createCall).toBeInstanceOf(CreateIndexCommand);
    expect(createCall.input.metadataConfiguration).toEqual({
      nonFilterableMetadataKeys: ['large_field'],
    });
  });
});

// ─── getByIds duplicate ID handling ──────────────────────────────────────────

describe('AmazonS3Vectors.getByIds with duplicate IDs', () => {
  it('returns independent metadata for duplicate IDs', async () => {
    const { client, mockSend } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mockSend.mockResolvedValueOnce({
      vectors: [
        {
          key: 'id-1',
          metadata: {
            _page_content: 'hello',
            nested: { value: 'original' },
          },
        },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-1']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('hello');
    expect(docs[1]!.pageContent).toBe('hello');

    // Mutating one document's metadata must not affect the other.
    (docs[0]!.metadata['nested'] as Record<string, string>).value = 'mutated';
    expect((docs[1]!.metadata['nested'] as Record<string, string>).value).toBe('original');
  });
});

// ─── addDocuments per-batch embedding ────────────────────────────────────────

describe('AmazonS3Vectors.addDocuments per-batch embedding', () => {
  it('embeds documents per batch instead of all at once', async () => {
    const { client, mockSend } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    // GetIndex succeeds
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    // Two PutVectors calls
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    await store.addDocuments(docs, { batchSize: 2 });

    // embedDocuments should be called twice: once for ["a","b"], once for ["c"]
    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(2, ['c']);
  });
});

// ─── addTexts tests ──────────────────────────────────────────────────────────

describe('AmazonS3Vectors.addTexts', () => {
  it('converts texts and metadatas into documents and stores them', async () => {
    const { client, mockSend } = createMockClient();
    const embeddings = createMockEmbeddings(3);

    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    // GetIndex succeeds
    mockSend.mockResolvedValueOnce({ indexName: 'test-index' });
    // PutVectors succeeds
    mockSend.mockResolvedValueOnce({});

    const ids = await store.addTexts(['hello', 'world'], [{ genre: 'a' }, { genre: 'b' }], {
      ids: ['t-1', 't-2'],
    });

    expect(ids).toEqual(['t-1', 't-2']);

    const putCall = mockSend.mock.calls[1]![0]!;
    expect(putCall).toBeInstanceOf(PutVectorsCommand);
    expect(putCall.input.vectors[0].metadata).toEqual({
      genre: 'a',
      _page_content: 'hello',
    });
    expect(putCall.input.vectors[1].metadata).toEqual({
      genre: 'b',
      _page_content: 'world',
    });
  });

  it('throws when metadatas count mismatches texts', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    await expect(store.addTexts(['a', 'b'], [{ x: 1 }])).rejects.toThrow('must match');
  });
});
