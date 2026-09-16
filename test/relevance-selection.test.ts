import { QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore } from './helpers.js';

/**
 * Relevance-score selection. No fixed formula can map an unbounded euclidean
 * distance to a comparable score without knowing the embedding's scale, and
 * only the caller knows that — so a euclidean store without `relevanceScoreFn`
 * fails closed rather than returning numbers from an arbitrary divisor.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

const queryResolving = (distance: number, metric: 'cosine' | 'euclidean'): object => ({
  vectors: [{ key: 'a', metadata: { _page_content: 'hello' }, distance }],
  distanceMetric: metric,
});

describe('relevance score selection', () => {
  it('fails closed for a euclidean store with no relevanceScoreFn, before any request', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'euclidean' });
    mock.on(QueryVectorsCommand).resolves(queryResolving(0.5, 'euclidean'));

    const error = await store.similaritySearchWithRelevanceScores('q', 1).catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // Refusing is only half of it: the message has to say why no default is
    // possible, and give the caller both ways forward.
    expect((error as Error).message).toBe(
      'A euclidean index has no built-in relevance-score conversion: no fixed formula can map ' +
        'an unbounded euclidean distance to a comparable score without knowing your ' +
        "embedding's scale, which only you know. Supply `relevanceScoreFn` in the store " +
        'config, or use similaritySearchWithScore for raw distances.',
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('uses a caller-supplied relevanceScoreFn on a euclidean store', async () => {
    const { store, mock } = createTestStore({
      distanceMetric: 'euclidean',
      relevanceScoreFn: (distance: number) => 1 / (1 + distance),
    });
    mock.on(QueryVectorsCommand).resolves(queryResolving(1, 'euclidean'));

    const results = await store.similaritySearchWithRelevanceScores('q', 1);
    const score = results[0]![1];
    expect(score).toBeCloseTo(0.5);
  });

  it('uses 1 - distance on a cosine store, the exact inverse of the measured definition', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'cosine' });
    mock.on(QueryVectorsCommand).resolves(queryResolving(0.25, 'cosine'));

    const results = await store.similaritySearchWithRelevanceScores('q', 1);
    const score = results[0]![1];
    expect(score).toBeCloseTo(0.75);
  });

  it('prefers a caller-supplied function over the built-in cosine one', async () => {
    const { store, mock } = createTestStore({
      distanceMetric: 'cosine',
      relevanceScoreFn: () => 0.123,
    });
    mock.on(QueryVectorsCommand).resolves(queryResolving(0.25, 'cosine'));

    const results = await store.similaritySearchWithRelevanceScores('q', 1);
    const score = results[0]![1];
    expect(score).toBe(0.123);
  });

  it('leaves the raw-distance search working on a euclidean store', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'euclidean' });
    mock.on(QueryVectorsCommand).resolves(queryResolving(9, 'euclidean'));

    const results = await store.similaritySearchWithScore('q', 1);
    const distance = results[0]![1];
    expect(distance).toBe(9);
  });
});
