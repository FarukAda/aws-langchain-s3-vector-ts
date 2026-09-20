import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { cosineRelevanceScoreFn } from '../src/relevance-scores.js';
import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';
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

describe('the text searches reject before spending anything', () => {
  it.each([
    ['similaritySearch', (store: AmazonS3Vectors) => store.similaritySearch('q', 0)],
    [
      'similaritySearchWithScore',
      (store: AmazonS3Vectors) => store.similaritySearchWithScore('q', 0),
    ],
    [
      'similaritySearchWithRelevanceScores',
      (store: AmazonS3Vectors) => store.similaritySearchWithRelevanceScores('q', 0),
    ],
  ])('%s rejects an invalid k before embedQuery, which is billable', async (_label, run) => {
    const { store, mock, embeddings } = createTestStore();
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });
});

describe('AmazonS3Vectors — which embedding model answers which call', () => {
  it('raises EMBEDDINGS_MISSING for a text query when neither model is configured', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const error = await store.similaritySearchWithScore('query', 1).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
    expect((error as Error).message).toBe(
      'No embedding model available for queries. Provide `embeddings` or `queryEmbeddings` ' +
        'in the config.',
    );
  });

  it('answers text queries from queryEmbeddings alone, with no indexing model at all', async () => {
    // A legitimate store: vectors are written elsewhere (or by addVectors),
    // and this instance only needs to embed queries.
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      vectors: [{ key: 'k', metadata: { _page_content: 'found' }, distance: 0.1 }],
    });
    const store = new AmazonS3Vectors(undefined, {
      ...BASE_CONFIG,
      client,
      queryEmbeddings: createMockEmbeddings(3),
    });

    expect(await store.similaritySearch('query', 1)).toHaveLength(1);

    // …and writing from text still fails, naming the option to set.
    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })])
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
    expect((error as Error).message).toContain('Provide `embeddings`');
  });
});

describe('AmazonS3Vectors.similaritySearchVectorWithScore fallbacks', () => {
  it('returns an empty array when the response has no vectors field', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine' });

    const results = await store.similaritySearchVectorWithScore([1], 1);
    expect(results).toEqual([]);
  });

  it('throws AWS_INVALID_RESPONSE instead of defaulting the score when distance is absent', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'x' } }],
      distanceMetric: 'cosine',
    });

    const error = await store.similaritySearchVectorWithScore([1], 1).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
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

describe('AmazonS3Vectors.similaritySearch fallbacks', () => {
  it('defaults topK to 4 and handles a missing vectors field', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine' });

    const results = await store.similaritySearch('q');
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

/**
 * The relevance conversion, observed through the search that applies it.
 *
 * These used to call `_selectRelevanceScoreFn()` directly, which was possible
 * only because TypeScript's `private` is erased: the method was absent from the
 * published `.d.ts` and callable at runtime, and its own comment claimed
 * `@langchain/core` called it, which core does not — this package's own
 * `similaritySearchWithRelevanceScores` does. It is `#private` now, so the
 * conversion is checked where a caller actually meets it.
 */
describe('AmazonS3Vectors relevance-score conversion', () => {
  function storeReturning(
    distance: number,
    config: Partial<AmazonS3VectorsConfig> = {},
  ): AmazonS3Vectors {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'id-1', metadata: { _page_content: 'p' }, distance }],
      // The response reports whichever metric the store was configured for, so
      // the metric check passes and the scoring is what is under test.
      distanceMetric: config.distanceMetric ?? 'cosine',
    });
    return new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, ...config, client });
  }

  it('uses the cosine conversion by default', async () => {
    const scored = await storeReturning(0.3).similaritySearchWithRelevanceScores('q', 1);
    expect(scored[0]?.[1]).toBe(cosineRelevanceScoreFn(0.3));
  });

  it('refuses to invent a conversion for euclidean, which has no principled one', async () => {
    const store = storeReturning(0.3, { distanceMetric: 'euclidean' });
    await expect(store.similaritySearchWithRelevanceScores('q', 1)).rejects.toThrow(
      'relevanceScoreFn',
    );
  });

  it('uses a custom conversion when one is configured', async () => {
    const store = storeReturning(1, { relevanceScoreFn: (d: number) => 42 - d });
    const scored = await store.similaritySearchWithRelevanceScores('q', 1);
    expect(scored[0]?.[1]).toBe(41);
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

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 4);

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

  it('keeps paging through a long run of result-less pages, since only an empty token ends a search', async () => {
    const { store, mock } = createTestStore();

    // Twenty empty-but-continuing pages, well past the streak guard that used
    // to stop here. An empty page carrying a nextToken is a conforming
    // response, and a heavily filtered query is a plausible way to get one.
    let call = 0;
    mock.on(QueryVectorsCommand).callsFake(() => {
      call += 1;
      return call <= 20
        ? { distanceMetric: 'cosine', vectors: [], nextToken: `t${call}` }
        : {
            distanceMetric: 'cosine',
            vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
          };
    });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 1);
    expect(results).toHaveLength(1);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(21);
  });

  it('keeps paging a sparse-but-progressing search until k is satisfied', async () => {
    const { store, mock } = createTestStore();

    // One usable result per page, forever. This converges — it just takes
    // one page per result. AWS documents its page size as "up to 100", so a
    // short page is a conforming response and this is a legitimate search;
    // the previous flat 100-page cap failed it at page 100 with only 100 of
    // the 500 requested results.
    mock.on(QueryVectorsCommand).callsFake(() => ({
      distanceMetric: 'cosine',
      vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
      nextToken: 'more',
    }));

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 500);

    expect(results).toHaveLength(500);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(500);
  });

  it('still bounds a progressing search at the absolute page ceiling', async () => {
    const { store, mock } = createTestStore();

    // One result per page with k above the page ceiling: every page makes
    // progress, so the empty-page guard never fires, and only the runaway
    // backstop can stop it. It must still fail closed rather than return a
    // silently short result set.
    mock.on(QueryVectorsCommand).callsFake(() => ({
      distanceMetric: 'cosine',
      vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
      nextToken: 'more',
    }));

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 2000)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED,
    );
    expect((error as Error).message).toContain('1000-page ceiling');
    expect(
      (error as { context: { pagesScanned: number; resultsCollected: number } }).context,
    ).toMatchObject({ pagesScanned: 1000, resultsCollected: 1000 });
  });

  it('tolerates a short run of result-less pages when real results follow', async () => {
    const { store, mock } = createTestStore();

    // Nine empty pages is under the streak limit, so the tenth page's real
    // result must still be collected rather than the search bailing early.
    let call = 0;
    mock.on(QueryVectorsCommand).callsFake(() => {
      call += 1;
      if (call <= 9) return { distanceMetric: 'cosine', vectors: [], nextToken: 'more' };
      return {
        distanceMetric: 'cosine',
        vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
      };
    });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 5)).resolves.toHaveLength(1);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(10);
  });

  it('does not throw at the page cap once k is already satisfied', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).callsFake(() => ({
      distanceMetric: 'cosine',
      vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
      nextToken: 'more',
    }));

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 3)).resolves.toHaveLength(3);
  });

  it('does not throw when pagination legitimately ends short of k', async () => {
    const { store, mock } = createTestStore();

    // No nextToken: the result set really is exhausted, which is a normal
    // outcome and must stay distinguishable from hitting the page cap.
    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
    });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 50)).resolves.toHaveLength(1);
  });

  it('rejects k values that are not a positive integer', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 0)).rejects.toThrow(
      'k must be a positive integer',
    );
    await expect(store.similaritySearchVectorWithScore([1, 2, 3], -1)).rejects.toThrow(
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

describe('parseFilter — array and non-plain-object filters', () => {
  it('rejects an array filter instead of forwarding it to AWS', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(store.similaritySearchVectorWithScore([1, 2, 3], 4, [] as never)).rejects.toThrow(
      'arrays are not a valid filter shape',
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('rejects a non-empty Map filter with a clear message instead of "empty object"', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, new Map([['genre', 'x']]) as never),
    ).rejects.toThrow("which AWS's filter syntax does not accept");
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('allows a null filter (treated the same as omitting it)', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, null as never),
    ).resolves.toEqual([]);
  });

  it('rejects a primitive (non-object) filter value', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, 'genre:scifi' as never),
    ).rejects.toThrow("received a string, which AWS's filter syntax does not accept");
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('rejects a non-plain object with no distinguishing constructor name', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    // Object.create({}) — prototype is a plain object literal, not the shared
    // Object.prototype, so isPlainFilterObject rejects it; its constructor
    // still resolves (via the prototype chain) to the Object global, so
    // describeFilterValue must fall back to a generic label instead of the
    // misleading "an Object instance".
    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, Object.create({}) as never),
    ).rejects.toThrow("received a non-plain object, which AWS's filter syntax does not accept");
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('uses "an" instead of "a" for a vowel-initial constructor name', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, new Error('boom') as never),
    ).rejects.toThrow("received an Error instance, which AWS's filter syntax does not accept");
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  // isPlainFilterObject's `proto === null` branch exists specifically to
  // accept this shape (a prototype-pollution-safe dictionary built with
  // Object.create(null)) as a *valid* filter — distinct from every other
  // test above, which only exercises that comparison evaluating to false.
  it('accepts an Object.create(null) dictionary filter', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });

    const filter = Object.create(null, { genre: { value: 'x', enumerable: true } });

    await expect(
      store.similaritySearchVectorWithScore([1, 2, 3], 4, filter as never),
    ).resolves.toEqual([]);
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.filter).toBe(filter);
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
    // A malformed/absent metric is a bad *response*, not a config mismatch —
    // AWS_INVALID_RESPONSE is what that enum member documents. A valid but
    // disagreeing metric still reports INDEX_CONFIG_MISMATCH, above.
    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
    expect((error as Error).message).toContain('did not include a recognisable distanceMetric');
  });
});

describe('AmazonS3Vectors query-vector validation', () => {
  it('rejects a non-array query vector before calling AWS', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine', vectors: [] });

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .similaritySearchVectorWithScore('nope' as any, 1)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('Query vector is not an array (received a string).');
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });
});

describe('AmazonS3Vectors response guards — present-but-invalid values', () => {
  // A guard testing only `=== undefined` let an explicit null through, and
  // `1.0 - null` coerces to 1.0 — the exact best-possible-score misranking
  // 0.7.0 set out to close, reached by a different value.
  it.each([
    ['null', null],
    ['a string', '0.5'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('throws AWS_INVALID_RESPONSE when distance is %s', async (_label, distance) => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- malformed response by construction
      vectors: [{ key: 'a', metadata: { _page_content: 'x' }, distance }] as any,
    });

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 1)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
  });

  it('does not misreport a legitimate zero distance as invalid', async () => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      vectors: [{ key: 'a', metadata: { _page_content: 'x' }, distance: 0 }],
    });

    const results = await store.similaritySearchVectorWithScore([1, 2, 3], 1);
    expect(results[0]![1]).toBe(0);
  });

  it.each([
    ['null', null],
    ['an unrecognised value', 'manhattan'],
  ])('throws AWS_INVALID_RESPONSE when distanceMetric is %s', async (_label, distanceMetric) => {
    const { store, mock } = createTestStore();

    mock.on(QueryVectorsCommand).resolves({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- malformed response by construction
      distanceMetric: distanceMetric as any,
      vectors: [],
    });

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 1)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
  });
});

describe('AmazonS3Vectors text search — checks before the billable embedQuery', () => {
  it('does not call embedQuery when the signal is already aborted', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine', vectors: [] });

    const controller = new AbortController();
    controller.abort();

    const error = await store
      .similaritySearch('q', 4, undefined, undefined, controller.signal)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('does not call embedQuery when the filter is an empty object', async () => {
    const { store, embeddings } = createTestStore();

    const error = await store.similaritySearch('q', 4, {}).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('does not call embedQuery when maxMarginalRelevanceSearch gets a bad filter', async () => {
    const { store, embeddings } = createTestStore();

    const error = await store
      .maxMarginalRelevanceSearch('q', { k: 2, fetchK: 4, filter: { genre: { $eg: 'scifi' } } })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain("unknown operator '$eg'");
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('does not call embedQuery when the filter is not a plain object', async () => {
    const { store, embeddings } = createTestStore();

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed filter
      .similaritySearchWithScore('q', 4, new Map() as any)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });
});

describe('a text query that is not a string is refused before it is embedded (N5)', () => {
  it.each([
    [
      'similaritySearch',
      (store: AmazonS3Vectors, q: unknown) => store.similaritySearch(q as string, 1),
    ],
    [
      'similaritySearchWithScore',
      (store: AmazonS3Vectors, q: unknown) => store.similaritySearchWithScore(q as string, 1),
    ],
    [
      'similaritySearchWithRelevanceScores',
      (store: AmazonS3Vectors, q: unknown) =>
        store.similaritySearchWithRelevanceScores(q as string, 1),
    ],
    [
      'maxMarginalRelevanceSearch',
      (store: AmazonS3Vectors, q: unknown) =>
        store.maxMarginalRelevanceSearch(q as string, { k: 1 }),
    ],
  ])('%s', async (operation, run) => {
    const { store, mock, embeddings } = createTestStore();
    const error = await run(store, ['a', 'b']).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe(
      'The query must be a string (received an array). It is the text the embeddings model embeds.',
    );
    expect((error as { context: { operation: string } }).context.operation).toBe(operation);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('an unusable query embedding is refused before any request on every search path (R4)', () => {
  const zero = {
    embedDocuments: async (texts: string[]) => texts.map(() => [0, 0, 0]),
    embedQuery: async () => [0, 0, 0],
  };

  it.each([
    ['similaritySearch', (store: AmazonS3Vectors) => store.similaritySearch('q', 1)],
    [
      'maxMarginalRelevanceSearch',
      (store: AmazonS3Vectors) => store.maxMarginalRelevanceSearch('q', { k: 1 }),
    ],
    [
      'an MMR retriever',
      (store: AmazonS3Vectors) => store.asRetriever({ k: 1, searchType: 'mmr' }).invoke('q'),
    ],
  ])('%s', async (_label, run) => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(zero, { ...BASE_CONFIG, client });
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('Query vector has zero norm');
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });
});
