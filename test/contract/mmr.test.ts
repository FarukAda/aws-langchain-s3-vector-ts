import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createTestStore } from '../helpers.js';

/**
 * MMR is a real capability now (DESIGN.md D-5), so core's runtime probe —
 * `typeof store.maxMarginalRelevanceSearch === 'function'`
 * (`@langchain/core@1.2.9` `dist/vectorstores.js:143`) — reports something
 * true rather than a method that exists only to throw.
 */
const VECTORS: Record<string, number[]> = {
  a: [1, 0, 0],
  b: [0.9, 0.1, 0],
  c: [0, 1, 0],
};

function mmrStore() {
  const { store, mock } = createTestStore();
  mock.on(QueryVectorsCommand).resolves({
    distanceMetric: 'cosine',
    vectors: Object.keys(VECTORS).map((key) => ({ key, metadata: { _page_content: key } })),
  });
  mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => ({
    vectors: input.keys.map((k) => ({
      key: k,
      data: { float32: VECTORS[k] },
      metadata: { _page_content: k },
    })),
  }));
  return { store, mock };
}

describe('maxMarginalRelevanceSearch', () => {
  it('is a function, so a capability probe reports the truth', () => {
    const { store } = mmrStore();
    expect(typeof store.maxMarginalRelevanceSearch).toBe('function');
  });

  it('returns documents rather than throwing', async () => {
    const { store } = mmrStore();
    const docs = await store.maxMarginalRelevanceSearch('q', { k: 2 });
    expect(docs).toHaveLength(2);
    expect(docs[0]?.pageContent).toBeDefined();
  });

  it('works through asRetriever({ searchType: "mmr" }), the path core dispatches', async () => {
    const { store } = mmrStore();
    const docs = await store.asRetriever({ k: 2, searchType: 'mmr' }).invoke('q');
    expect(docs).toHaveLength(2);
  });

  it('honours k', async () => {
    const { store } = mmrStore();
    expect(await store.maxMarginalRelevanceSearch('q', { k: 1 })).toHaveLength(1);
  });

  it('defaults k, fetchK and lambda when the caller supplies none', async () => {
    const { store, mock } = mmrStore();
    // Core declares `k` required, so this state is reachable only from an
    // untyped caller — a widening, which per the contract standard still needs
    // a decided answer. Only three candidates exist, so the default k of 4
    // yields all three.
    const docs = await store.maxMarginalRelevanceSearch('q', {} as never);
    expect(docs).toHaveLength(3);
    // The default fetchK of 20 is what was asked of the service.
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({ topK: 20 });
  });

  it('rejects an AbortSignal handed to the Callbacks slot, as its siblings do', async () => {
    const { store } = mmrStore();
    const ac = new AbortController();
    const error = await store
      .maxMarginalRelevanceSearch('q', { k: 1 }, ac.signal as never)
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain('AbortSignal');
  });

  it('accepts a signal in the fourth slot and rejects when it has already fired', async () => {
    const { store, mock } = mmrStore();
    const ac = new AbortController();
    ac.abort();
    const error = await store
      .maxMarginalRelevanceSearch('q', { k: 1 }, undefined, ac.signal)
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('ABORTED');
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });
});
