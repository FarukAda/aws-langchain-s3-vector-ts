import { QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from '../src/relevance-scores.js';
import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createMockClient, createMockEmbeddings } from './helpers.js';

const BASE_CONFIG = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
} as const;

describe('AmazonS3Vectors.similaritySearchVectorWithScore', () => {
  it('returns scored documents from QueryVectors', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(QueryVectorsCommand).resolves({
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

    const queryCalls = mock.commandCalls(QueryVectorsCommand);
    expect(queryCalls).toHaveLength(1);
    const input = queryCalls[0]!.args[0].input;
    expect(input.returnDistance).toBe(true);
    expect(input.returnMetadata).toBe(true);
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore', () => {
  it('embeds query and returns scored results', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();
    const store = new AmazonS3Vectors(embeddings, {
      ...BASE_CONFIG,
      client,
    });

    mock.on(QueryVectorsCommand).resolves({
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
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'doc' } }],
    });

    const results = await store.similaritySearchByVector([1, 2, 3], 1);

    expect(results).toHaveLength(1);
    expect(results[0]!.pageContent).toBe('doc');

    const queryCalls = mock.commandCalls(QueryVectorsCommand);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]!.args[0].input.returnDistance).toBe(false);
  });
});

describe('AmazonS3Vectors page_content handling', () => {
  it('extracts page_content from metadata key', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });

    mock.on(QueryVectorsCommand).resolves({
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
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      pageContentMetadataKey: null,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { some_field: 'value' }, distance: 0 }],
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![0].pageContent).toBe('');
    expect(results[0]![0].metadata).toEqual({ some_field: 'value' });
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore without embeddings', () => {
  it('throws when no embedding model is available for queries', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
    });

    await expect(store.similaritySearchWithScore('query', 1)).rejects.toThrow(
      'No embedding model available for queries',
    );
  });
});

describe('AmazonS3Vectors.similaritySearchVectorWithScore fallbacks', () => {
  it('returns an empty array when the response has no vectors field', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({});

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results).toEqual([]);
  });

  it('defaults the score to 0 when distance is absent', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' } }],
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![1]).toBe(0);
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore default k', () => {
  it('defaults topK to 4', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({ vectors: [] });

    await store.similaritySearchWithScore('q');
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore with queryEmbeddings', () => {
  it('uses the dedicated query-embedding model', async () => {
    const { client, mock } = createMockClient();
    const indexEmb = createMockEmbeddings();
    const queryEmb = createMockEmbeddings(5);
    const store = new AmazonS3Vectors(indexEmb, {
      ...BASE_CONFIG,
      client,
      queryEmbeddings: queryEmb,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'r' }, distance: 0.1 }],
    });

    await store.similaritySearchWithScore('q', 1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });
});

describe('AmazonS3Vectors.similaritySearchByVector fallbacks', () => {
  it('defaults topK to 4 and handles a missing vectors field', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({});

    const results = await store.similaritySearchByVector([1]);
    expect(results).toEqual([]);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
  });
});

describe('AmazonS3Vectors.similaritySearch', () => {
  it('uses the dedicated query-embedding model, not the indexing model', async () => {
    const { client, mock } = createMockClient();
    const indexEmb = createMockEmbeddings();
    const queryEmb = createMockEmbeddings(5);
    const store = new AmazonS3Vectors(indexEmb, {
      ...BASE_CONFIG,
      client,
      queryEmbeddings: queryEmb,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'r' }, distance: 0.1 }],
    });

    const docs = await store.similaritySearch('q', 1);
    expect(docs).toHaveLength(1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });

  it('defaults topK to 4', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({ vectors: [] });

    await store.similaritySearch('q');
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
  });

  it('accepts a 4th callbacks argument without error (matches the base VectorStore signature)', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({ vectors: [] });

    await expect(store.similaritySearch('q', 4, undefined, undefined)).resolves.toEqual([]);
  });
});

describe('AmazonS3Vectors.asRetriever', () => {
  it('routes through the dedicated query-embedding model via similaritySearch', async () => {
    const { client, mock } = createMockClient();
    const indexEmb = createMockEmbeddings();
    const queryEmb = createMockEmbeddings(5);
    const store = new AmazonS3Vectors(indexEmb, {
      ...BASE_CONFIG,
      client,
      queryEmbeddings: queryEmb,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'r' }, distance: 0.1 }],
    });

    const retriever = store.asRetriever(2);
    const docs = await retriever.invoke('q');
    expect(docs).toHaveLength(1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });
});

describe('AmazonS3Vectors.similaritySearchWithRelevanceScores', () => {
  it('applies the selected relevance-score function to each distance', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'a' }, distance: 0 },
        { key: 'id-2', metadata: { _page_content: 'b' }, distance: 1 },
      ],
    });

    const results = await store.similaritySearchWithRelevanceScores('q', 2);
    expect(results).toHaveLength(2);
    expect(results[0]![1]).toBe(cosineRelevanceScoreFn(0));
    expect(results[1]![1]).toBe(cosineRelevanceScoreFn(1));
  });

  it('uses a custom relevanceScoreFn when configured', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      relevanceScoreFn: (d) => 100 - d,
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'a' }, distance: 3 }],
    });

    const results = await store.similaritySearchWithRelevanceScores('q', 1);
    expect(results[0]![1]).toBe(97);
  });

  it('defaults k to 4', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    mock.on(QueryVectorsCommand).resolves({ vectors: [] });

    await store.similaritySearchWithRelevanceScores('q');
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
  });
});

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
