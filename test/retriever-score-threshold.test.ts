import { QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';
import { createTestStore } from './helpers.js';

/**
 * A relevance threshold on the retriever, because the obvious way to get one
 * from LangChain is wrong against this store: `@langchain/classic`'s
 * `ScoreThresholdRetriever` keeps results where `score >= minSimilarityScore`
 * while `similaritySearchWithScore` here returns AWS's raw *distance*, where
 * lower is better — so it keeps the worst matches and drops the best. This
 * threshold reads the relevance score instead, the same conversion
 * `similaritySearchWithRelevanceScores` applies.
 */
function storeWithResults(configOverrides: Partial<AmazonS3VectorsConfig> = {}) {
  const { store, mock } = createTestStore(configOverrides);
  mock.on(QueryVectorsCommand).resolves({
    distanceMetric: configOverrides.distanceMetric ?? 'cosine',
    vectors: [
      { key: 'near', distance: 0.05, metadata: { _page_content: 'nearly identical' } },
      { key: 'middling', distance: 0.5, metadata: { _page_content: 'related' } },
      { key: 'opposite', distance: 1.9, metadata: { _page_content: 'unrelated' } },
    ],
  });
  return { store, mock };
}

const refusalOf = (run: () => unknown): S3VectorsError => {
  try {
    run();
  } catch (error: unknown) {
    return error as S3VectorsError;
  }
  throw new Error('expected a refusal');
};

describe('asRetriever({ scoreThreshold })', () => {
  it('keeps the documents at or above the threshold, best first', async () => {
    const { store } = storeWithResults();

    const docs = await store.asRetriever({ k: 3, scoreThreshold: 0.5 }).invoke('query');

    // Cosine relevance is 1 − distance: 0.95, 0.5 and −0.9.
    expect(docs.map((doc) => doc.id)).toEqual(['near', 'middling']);
  });

  it('returns nothing when nothing is relevant enough, rather than the best of a bad set', async () => {
    const { store } = storeWithResults();

    const docs = await store.asRetriever({ k: 3, scoreThreshold: 0.99 }).invoke('query');

    expect(docs).toEqual([]);
  });

  it('leaves every result when no threshold is set', async () => {
    const { store } = storeWithResults();

    const docs = await store.asRetriever({ k: 3 }).invoke('query');

    expect(docs.map((doc) => doc.id)).toEqual(['near', 'middling', 'opposite']);
  });

  it('refuses a threshold on an MMR retriever, which has no scores to compare', () => {
    const { store } = storeWithResults();

    const error = refusalOf(() => store.asRetriever({ searchType: 'mmr', scoreThreshold: 0.5 }));

    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('scoreThreshold');
    expect(error.message).toContain('mmr');
    expect(error.context.operation).toBe('asRetriever');
  });

  it('refuses a threshold that is not a number', () => {
    const { store } = storeWithResults();

    const error = refusalOf(() => store.asRetriever({ scoreThreshold: '0.5' as never }));

    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('scoreThreshold');
  });

  it('refuses one on a euclidean index with no conversion, when the retriever is built', () => {
    // Not when it runs: the class promises its fields are checked where it is
    // built, and a euclidean index has no built-in distance-to-relevance
    // conversion to threshold against.
    const { store } = storeWithResults({ distanceMetric: 'euclidean' });

    const error = refusalOf(() => store.asRetriever({ scoreThreshold: 0.5 }));

    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('relevanceScoreFn');
  });

  it('accepts one on a euclidean index that supplies the conversion', async () => {
    const { store } = storeWithResults({
      distanceMetric: 'euclidean',
      relevanceScoreFn: (distance: number) => 1 / (1 + distance),
    });

    const docs = await store.asRetriever({ k: 3, scoreThreshold: 0.6 }).invoke('query');

    // 1/(1+d): 0.952, 0.667, 0.345.
    expect(docs.map((doc) => doc.id)).toEqual(['near', 'middling']);
  });
});
