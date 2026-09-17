import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createTestStore } from '../helpers.js';

/**
 * The one order every public entry point follows when several faults coincide
 * (owner ruling, 2026-09-16 report remediation, D2):
 *
 *   1. VALIDATION — everything knowable from the arguments alone: the options
 *      bag, argument types and counts, ids, documents and metadata,
 *      batchSize/pageSize/k/other options, signal type, filter.
 *   2. ABORTED — an already-fired signal.
 *   3. Empty input returns its empty result, without any request or embedding.
 *   4. Spend — resolving the embeddings model (EMBEDDINGS_MISSING), embedding,
 *      then AWS requests.
 *
 * So: an invalid argument beats a fired signal; a fired signal beats an empty
 * input's free return; and an empty input is answered before anything is
 * resolved or spent on it, addDocuments's embeddings model included.
 */

type Store = ReturnType<typeof createTestStore>['store'];

const fired = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

const drain = async (iterator: AsyncGenerator<unknown>): Promise<void> => {
  for await (const _item of iterator) break;
};

const doc = (): Document => new Document({ pageContent: 'page content' });

describe('check order — (a) an invalid argument beats a fired signal: VALIDATION', () => {
  const CASES: [string, (store: Store) => Promise<unknown>][] = [
    // A malformed id — an empty string, which every id-bearing entry point
    // refuses — paired with an already-fired signal.
    [
      'addVectors',
      (store) => store.addVectors([[1, 2, 3]], [doc()], { ids: [''], signal: fired() }),
    ],
    ['addDocuments', (store) => store.addDocuments([doc()], { ids: [''], signal: fired() })],
    ['getByIds', (store) => store.getByIds([''], { signal: fired() })],
    ['delete', (store) => store.delete({ ids: [''], signal: fired() })],
    // An impossible k, paired with an already-fired signal.
    ['similaritySearch', (store) => store.similaritySearch('q', 0, undefined, undefined, fired())],
    [
      'similaritySearchWithScore',
      (store) => store.similaritySearchWithScore('q', 0, undefined, undefined, fired()),
    ],
    [
      'similaritySearchWithRelevanceScores',
      (store) => store.similaritySearchWithRelevanceScores('q', 0, undefined, undefined, fired()),
    ],
    [
      'similaritySearchVectorWithScore',
      (store) => store.similaritySearchVectorWithScore([1, 2, 3], 0, undefined, fired()),
    ],
    [
      'maxMarginalRelevanceSearch',
      (store) => store.maxMarginalRelevanceSearch('q', { k: 0 }, undefined, fired()),
    ],
    // An impossible pageSize, paired with an already-fired signal; the
    // refusal arrives on the first `next()`, same as every other check here.
    ['listDocuments', (store) => drain(store.listDocuments({ pageSize: 0, signal: fired() }))],
    ['listVectors', (store) => drain(store.listVectors({ pageSize: 0, signal: fired() }))],
  ];

  it.each(CASES)(
    '%s: invalid input + fired signal is VALIDATION, not ABORTED',
    async (_op, run) => {
      const { store, mock } = createTestStore();
      const error = await run(store).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
      // Refused before spending anything, exactly like a lone VALIDATION fault.
      expect(mock.calls()).toHaveLength(0);
    },
  );
});

describe("check order — (b) a fired signal beats an empty input's free return: ABORTED", () => {
  const CASES: [string, (store: Store) => Promise<unknown>][] = [
    ['addVectors', (store) => store.addVectors([], [], { signal: fired() })],
    ['addDocuments', (store) => store.addDocuments([], { signal: fired() })],
    ['getByIds', (store) => store.getByIds([], { signal: fired() })],
    ['delete', (store) => store.delete({ ids: [], signal: fired() })],
  ];

  it.each(CASES)(
    '%s: valid empty input + fired signal is ABORTED, with zero AWS commands sent',
    async (_op, run) => {
      const { store, mock } = createTestStore();
      const error = await run(store).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
      expect(mock.calls()).toHaveLength(0);
    },
  );
});

describe('check order — (c) batchSize is checked even on empty input: VALIDATION', () => {
  const CASES: [string, (store: Store) => Promise<unknown>][] = [
    ['addVectors', (store) => store.addVectors([], [], { batchSize: 0 })],
    ['addDocuments', (store) => store.addDocuments([], { batchSize: 0 })],
    ['getByIds', (store) => store.getByIds([], { batchSize: 0 })],
    ['delete', (store) => store.delete({ ids: [], batchSize: 0 })],
  ];

  it.each(CASES)('%s: empty input with batchSize: 0 is VALIDATION, not []', async (_op, run) => {
    const { store, mock } = createTestStore();
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('check order — (d) addDocuments: input and emptiness are decided before the embeddings model is ever asked for', () => {
  it('an invalid input on a model-less store is VALIDATION, not EMBEDDINGS_MISSING', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .addDocuments('not-an-array' as any)
      .catch((e: unknown) => e);

    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('[] on a model-less store resolves [], not EMBEDDINGS_MISSING', async () => {
    const { client, mock } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    await expect(store.addDocuments([])).resolves.toEqual([]);
    expect(mock.calls()).toHaveLength(0);
  });

  it('one valid document on a model-less store is EMBEDDINGS_MISSING', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    const error = await store.addDocuments([doc()]).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
  });
});
