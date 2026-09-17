import {
  GetIndexCommand,
  GetVectorsCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { DocumentType } from '@smithy/types';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createTestStore, indexFixture } from '../helpers.js';

/**
 * Every error names the call the caller actually made.
 *
 * `S3VectorsErrorContext.operation` is the one field always present, and the
 * contract is that it holds the *public method's* name — not the AWS command's
 * — so a failure points at something the caller wrote. It is easy to get wrong
 * in a way nothing notices: the string is passed down through several layers,
 * and a wrong one still produces a perfectly plausible error.
 *
 * An already-fired signal is the cheapest way to make each method fail at its
 * own entry point, before any request.
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

const CASES: [string, (store: Store) => Promise<unknown>][] = [
  [
    'addVectors',
    (store) =>
      store.addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { signal: fired() }),
  ],
  [
    'addDocuments',
    (store) => store.addDocuments([new Document({ pageContent: 'x' })], { signal: fired() }),
  ],
  ['delete', (store) => store.delete({ ids: ['a'], signal: fired() })],
  ['getByIds', (store) => store.getByIds(['a'], { signal: fired() })],
  ['similaritySearch', (store) => store.similaritySearch('q', 1, undefined, undefined, fired())],
  [
    'similaritySearchWithScore',
    (store) => store.similaritySearchWithScore('q', 1, undefined, undefined, fired()),
  ],
  [
    'similaritySearchWithRelevanceScores',
    (store) => store.similaritySearchWithRelevanceScores('q', 1, undefined, undefined, fired()),
  ],
  [
    'similaritySearchVectorWithScore',
    (store) => store.similaritySearchVectorWithScore([1, 2, 3], 1, undefined, fired()),
  ],
  [
    'maxMarginalRelevanceSearch',
    (store) => store.maxMarginalRelevanceSearch('q', { k: 1 }, undefined, fired()),
  ],
  ['listDocuments', (store) => drain(store.listDocuments({ signal: fired() }))],
  ['listVectors', (store) => drain(store.listVectors({ signal: fired() }))],
  ['deleteIndex', (store) => store.deleteIndex({ signal: fired() })],
];

describe('every error names the public method that raised it', () => {
  it.each(CASES)('%s', async (operation, run) => {
    const { store } = createTestStore();
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: { operation: string } }).context.operation).toBe(operation);
  });

  it('an abort while waiting on a shared index creation names the write, not the wait', async () => {
    // Two writers race to create the index; one aborts mid-wait. The shared
    // creation is not cancelled — and the error the aborting caller sees
    // names their own call, not the internal step they happened to be
    // parked on.
    const { store, mock } = createTestStore();
    let releaseGetIndex!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseGetIndex = resolve;
    });
    mock.on(GetIndexCommand).callsFake(async () => {
      await held;
      return { index: indexFixture() };
    });
    mock.on(PutVectorsCommand).resolves({});

    const controller = new AbortController();
    const writing = store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], {
        signal: controller.signal,
      })
      .catch((e: unknown) => e);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    const error = await writing;
    releaseGetIndex();
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: { operation: string } }).context.operation).toBe('addVectors');
  });

  // The casts are the case under test: TypeScript refuses a signal in the
  // callbacks slot, so only an untyped caller can reach this guard — and that
  // is exactly who needs the message to name their own method.
  it.each([
    [
      'similaritySearch',
      (store: Store) => store.similaritySearch('q', 1, undefined, fired() as never),
    ],
    [
      'similaritySearchWithScore',
      (store: Store) => store.similaritySearchWithScore('q', 1, undefined, fired() as never),
    ],
    [
      'similaritySearchWithRelevanceScores',
      (store: Store) =>
        store.similaritySearchWithRelevanceScores('q', 1, undefined, fired() as never),
    ],
    [
      'maxMarginalRelevanceSearch',
      (store: Store) => store.maxMarginalRelevanceSearch('q', { k: 1 }, fired() as never),
    ],
  ])('%s names itself when a signal lands in the callbacks slot', async (operation, run) => {
    const { store } = createTestStore();
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe(operation);
  });

  it('addVectors names itself even with no index step to raise the abort', async () => {
    // With createIndexIfNotExist off there is no ensureExists to catch the
    // signal, so without the store's own check the SDK would reject the
    // PutVectors and the error would name that command instead.
    const { store, mock } = createTestStore({ createIndexIfNotExist: false });
    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { signal: fired() })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: { operation: string } }).context.operation).toBe('addVectors');
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('an MMR parameter rejection names the search, not the helper that validates it', async () => {
    const { store } = createTestStore();
    const error = await store.maxMarginalRelevanceSearch('q', { k: 0 }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe(
      'maxMarginalRelevanceSearch',
    );
  });

  it('the euclidean relevance refusal names the method that has no conversion', async () => {
    const { store } = createTestStore({ distanceMetric: 'euclidean' });
    const error = await store.similaritySearchWithRelevanceScores('q', 1).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe(
      'similaritySearchWithRelevanceScores',
    );
  });

  it('a retriever invocation names itself rather than the search underneath', async () => {
    const { store } = createTestStore();
    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q', { signal: fired() })
      .catch((e: unknown) => e);
    expect((error as { context: { operation: string } }).context.operation).toBe(
      'retriever.invoke',
    );
  });

  it('names the index and bucket alongside it, so the error identifies the target', async () => {
    const { store } = createTestStore();
    const error = await store.getByIds(['a'], { signal: fired() }).catch((e: unknown) => e);
    expect((error as { context: Record<string, unknown> }).context).toMatchObject({
      vectorBucketName: 'test-bucket',
      indexName: 'test-index',
    });
  });

  it.each([
    ['similaritySearch', (store: Store) => store.similaritySearch('q', 1)],
    ['similaritySearchWithScore', (store: Store) => store.similaritySearchWithScore('q', 1)],
    [
      'similaritySearchWithRelevanceScores',
      (store: Store) => store.similaritySearchWithRelevanceScores('q', 1),
    ],
    [
      'maxMarginalRelevanceSearch',
      (store: Store) => store.maxMarginalRelevanceSearch('q', { k: 1 }),
    ],
  ])('%s names itself when no embeddings model is configured (R9)', async (operation, run) => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.EMBEDDINGS_MISSING);
    expect((error as { context: { operation: string } }).context.operation).toBe(operation);
  });

  // Metadata that reaches createDocument but cannot be structured-cloned — a
  // function nested under a key. output-vectors.ts only checks that a `vectors`
  // entry is an object, so a value like this reaches createDocument unrejected.
  const UNCLONEABLE_METADATA = { _page_content: 'x', fn: () => 1 } as unknown as DocumentType;

  it.each([
    [
      'similaritySearchVectorWithScore',
      (store: Store) => store.similaritySearchVectorWithScore([1, 2, 3], 1),
    ],
    ['similaritySearch', (store: Store) => store.similaritySearch('q', 1)],
    ['similaritySearchWithScore', (store: Store) => store.similaritySearchWithScore('q', 1)],
    [
      'similaritySearchWithRelevanceScores',
      (store: Store) => store.similaritySearchWithRelevanceScores('q', 1),
    ],
    [
      'maxMarginalRelevanceSearch',
      (store: Store) => store.maxMarginalRelevanceSearch('q', { k: 1 }),
    ],
    ['getByIds', (store: Store) => store.getByIds(['id-1'])],
    ['listDocuments', (store: Store) => drain(store.listDocuments())],
    ['listVectors', (store: Store) => drain(store.listVectors())],
  ])(
    '%s names itself, and the bucket and index, when a result cannot be copied',
    async (operation, run) => {
      const { store, mock } = createTestStore();
      mock.on(QueryVectorsCommand).resolves({
        vectors: [{ key: 'id-1', metadata: UNCLONEABLE_METADATA, distance: 0.1 }],
        distanceMetric: 'cosine',
      });
      mock.on(GetVectorsCommand).resolves({
        vectors: [
          { key: 'id-1', data: { float32: [0.1, 0.2, 0.3] }, metadata: UNCLONEABLE_METADATA },
        ],
      });
      mock.on(ListVectorsCommand).resolves({
        vectors: [
          { key: 'id-1', data: { float32: [0.1, 0.2, 0.3] }, metadata: UNCLONEABLE_METADATA },
        ],
      });

      const error = await run(store).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
      expect((error as { context: { operation: string } }).context.operation).toBe(operation);
      expect((error as { context: Record<string, unknown> }).context).toMatchObject({
        vectorBucketName: 'test-bucket',
        indexName: 'test-index',
      });
      // Exactly these: a caller's options object also carries the client and the
      // signal, and neither may reach an error's context.
      expect(Object.keys((error as { context: object }).context).sort()).toEqual([
        'indexName',
        'operation',
        'vectorBucketName',
      ]);
    },
  );
});
