import { QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from '../src/relevance-scores.js';
import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings, createTestStore } from './helpers.js';

/**
 * Assert that `callMethod` defaults its `k`/topK parameter to 4 when
 * omitted. Shared across every search method, since they all delegate to
 * the same `QueryVectorsCommand` default.
 */
async function expectDefaultsTopKTo4(
  callMethod: (store: AmazonS3Vectors) => Promise<unknown>,
): Promise<void> {
  const { client, mock } = createMockClient();
  const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

  mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

  await callMethod(store);
  expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
}

/**
 * Set up a store with separate indexing/query embedding models and a
 * single-vector QueryVectorsCommand response — the shared scenario used to
 * prove `queryEmbeddings` routing across `similaritySearchWithScore`,
 * `similaritySearch`, and `asRetriever`.
 */
function setupQueryEmbeddingsScenario() {
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
    distanceMetric: 'cosine',
  });

  return { store, indexEmb, queryEmb };
}

describe('AmazonS3Vectors.similaritySearchVectorWithScore', () => {
  it('returns scored documents from QueryVectors', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'hello', genre: 'test' }, distance: 0.1 },
        { key: 'id-2', metadata: { _page_content: 'world', genre: 'test' }, distance: 0.5 },
      ],
      distanceMetric: 'cosine',
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
    const { store, mock, embeddings } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'result' }, distance: 0.2 }],
      distanceMetric: 'cosine',
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
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'doc' } }],
      distanceMetric: 'cosine',
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
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'the content', other: 'meta' }, distance: 0 },
      ],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![0].pageContent).toBe('the content');
    expect(results[0]![0].metadata).toEqual({ other: 'meta' });
    expect(results[0]![0].metadata).not.toHaveProperty('_page_content');
  });

  it('returns empty page_content when pageContentMetadataKey is null', async () => {
    const { store, mock } = createTestStore({ pageContentMetadataKey: null });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { some_field: 'value' }, distance: 0 }],
      distanceMetric: 'cosine',
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
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine' });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results).toEqual([]);
  });

  it('defaults the score to 0 when distance is absent', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' } }],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results[0]![1]).toBe(0);
  });
});

describe('AmazonS3Vectors.similaritySearchWithScore default k', () => {
  it('defaults topK to 4', () =>
    expectDefaultsTopKTo4((store) => store.similaritySearchWithScore('q')));
});

describe('AmazonS3Vectors.similaritySearchWithScore with queryEmbeddings', () => {
  it('uses the dedicated query-embedding model', async () => {
    const { store, indexEmb, queryEmb } = setupQueryEmbeddingsScenario();

    await store.similaritySearchWithScore('q', 1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });
});

describe('AmazonS3Vectors.similaritySearchByVector fallbacks', () => {
  it('defaults topK to 4 and handles a missing vectors field', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine' });

    const results = await store.similaritySearchByVector([1]);
    expect(results).toEqual([]);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.topK).toBe(4);
  });
});

describe('AmazonS3Vectors.similaritySearch', () => {
  it('uses the dedicated query-embedding model, not the indexing model', async () => {
    const { store, indexEmb, queryEmb } = setupQueryEmbeddingsScenario();

    const docs = await store.similaritySearch('q', 1);
    expect(docs).toHaveLength(1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });

  it('defaults topK to 4', () => expectDefaultsTopKTo4((store) => store.similaritySearch('q')));

  it('accepts a 4th callbacks argument without error (matches the base VectorStore signature)', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearch('q', 4, undefined, undefined)).resolves.toEqual([]);
  });
});

describe('AmazonS3Vectors.asRetriever', () => {
  it('routes through the dedicated query-embedding model via similaritySearch', async () => {
    const { store, indexEmb, queryEmb } = setupQueryEmbeddingsScenario();

    const retriever = store.asRetriever(2);
    const docs = await retriever.invoke('q');
    expect(docs).toHaveLength(1);
    expect(queryEmb.embedQuery).toHaveBeenCalledWith('q');
    expect(indexEmb.embedQuery).not.toHaveBeenCalled();
  });
});

describe('AmazonS3Vectors.similaritySearchWithRelevanceScores', () => {
  it('applies the selected relevance-score function to each distance', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'a' }, distance: 0 },
        { key: 'id-2', metadata: { _page_content: 'b' }, distance: 1 },
      ],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchWithRelevanceScores('q', 2);
    expect(results).toHaveLength(2);
    expect(results[0]![1]).toBe(cosineRelevanceScoreFn(0));
    expect(results[1]![1]).toBe(cosineRelevanceScoreFn(1));
  });

  it('uses a custom relevanceScoreFn when configured', async () => {
    const { store, mock } = createTestStore({ relevanceScoreFn: (d) => 100 - d });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'a' }, distance: 3 }],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchWithRelevanceScores('q', 1);
    expect(results[0]![1]).toBe(97);
  });

  it('defaults k to 4', () =>
    expectDefaultsTopKTo4((store) => store.similaritySearchWithRelevanceScores('q')));
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

describe('AmazonS3Vectors QueryVectors pagination', () => {
  it('follows nextToken until k results are collected', async () => {
    const { store, mock } = createTestStore();

    const page1 = Array.from({ length: 100 }, (_, i) => ({
      key: `id-${i}`,
      metadata: { _page_content: `doc-${i}` },
      distance: i / 1000,
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      key: `id-${100 + i}`,
      metadata: { _page_content: `doc-${100 + i}` },
      distance: (100 + i) / 1000,
    }));

    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({ vectors: page1, nextToken: 'page-2-token', distanceMetric: 'cosine' })
      .resolvesOnce({ vectors: page2 });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 150);

    expect(results).toHaveLength(150);
    expect(results[0]![0].pageContent).toBe('doc-0');
    expect(results[149]![0].pageContent).toBe('doc-149');

    const calls = mock.commandCalls(QueryVectorsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.nextToken).toBeUndefined();
    expect(calls[1]!.args[0].input.nextToken).toBe('page-2-token');
  });

  it('stops paging once the result set is exhausted, even below k', async () => {
    const { store, mock } = createTestStore();

    const page1 = Array.from({ length: 100 }, (_, i) => ({
      key: `id-${i}`,
      metadata: { _page_content: `doc-${i}` },
      distance: i / 1000,
    }));
    const page2 = Array.from({ length: 20 }, (_, i) => ({
      key: `id-${100 + i}`,
      metadata: { _page_content: `doc-${100 + i}` },
      distance: (100 + i) / 1000,
    }));

    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({ vectors: page1, nextToken: 'page-2-token', distanceMetric: 'cosine' })
      .resolvesOnce({ vectors: page2 });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 500);

    expect(results).toHaveLength(120);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(2);
  });

  it('does not page when the first response has no nextToken', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'only' }, distance: 0 }],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchByVector([1, 2, 3], 4);

    expect(results).toHaveLength(1);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(1);
  });

  it('does not stop early on an empty-but-nextToken-bearing page — later pages may still have real results', async () => {
    const { store, mock } = createTestStore();

    // A heavily-filtered query can legitimately return an empty page with
    // more still to come — AWS's own documented pagination contract has no
    // "stop on empty page" rule, so this store must keep paging rather than
    // silently discarding real results that show up on a later page.
    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({ vectors: [], nextToken: 'page-2-token', distanceMetric: 'cosine' })
      .resolvesOnce({ vectors: [{ key: 'id-1', metadata: { _page_content: 'x' }, distance: 0 }] });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 4);

    expect(results).toHaveLength(1);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(2);
  });

  it('bounds pagination at MAX_QUERY_PAGES when a response never converges', async () => {
    const { store, mock } = createTestStore();

    // A response that keeps returning nextToken without ever making
    // progress must still terminate — bounded, not stopped-on-empty-page.
    mock
      .on(QueryVectorsCommand)
      .resolves({ vectors: [], nextToken: 'still-more', distanceMetric: 'cosine' });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 500);

    expect(results).toEqual([]);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(100);
  });

  it('rejects k values that are not a positive integer', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 0)).rejects.toThrow(
      'k must be a positive integer',
    );
    await expect(store.similaritySearchByVector([1, 2, 3], -1)).rejects.toThrow(
      'k must be a positive integer',
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  // Confirmed live against real AWS: QueryVectors rejects topK above 10,000
  // with a ValidationException — checked locally before spending the round trip.
  it("rejects a k above AWS's topK limit of 10,000", async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 10_001)).rejects.toThrow(
      "k (10001) exceeds AWS's topK limit of 10000",
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('accepts a k exactly at the 10,000 topK limit', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 10_000)).resolves.toEqual([]);
  });

  // Confirmed live against real AWS: QueryVectors rejects an empty filter
  // object ({}) with "Invalid filter" — it is NOT treated as "no filter".
  it('rejects an empty filter object instead of forwarding it to AWS', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 4, {})).rejects.toThrow(
      'filter cannot be an empty object',
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('allows an undefined filter (no filtering)', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 4, undefined)).resolves.toEqual(
      [],
    );
  });

  it('allows a non-empty filter object', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, { genre: 'scifi' }),
    ).resolves.toEqual([]);
  });
});

describe('AmazonS3Vectors read-path distance-metric validation', () => {
  it('rejects a query when the index metric differs from the configured metric', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      distanceMetric: 'cosine',
    });

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' }, distance: 0.2 }],
      distanceMetric: 'euclidean',
    });

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 4)
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('euclidean');
  });

  it('allows a query when the index metric matches the configured metric', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' }, distance: 0.2 }],
      distanceMetric: 'cosine',
    });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 4);
    expect(results).toHaveLength(1);
  });

  // Confirmed live against real AWS: distanceMetric was present in every
  // response tested (empty index, filtered to zero results, and a normal
  // match), so a response that omits it is treated as "can't verify" and
  // rejected — fail closed, not fail open — rather than silently skipping
  // the check and risking a silently-wrong relevance score.
  it('rejects (fails closed) when AWS omits distanceMetric from the response', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' }, distance: 0.2 }],
    });

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 4)
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    );
    expect((error as Error).message).toContain('did not include a distanceMetric');
  });
});
