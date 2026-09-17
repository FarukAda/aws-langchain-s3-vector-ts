import {
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  GetVectorsCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Document } from '@langchain/core/documents';
import type { DocumentType } from '@smithy/types';

import { createIndexLifecycle } from '../../src/internal/index-lifecycle.js';
import { AmazonS3VectorsRetriever } from '../../src/retriever.js';
import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  createTestStore,
  drainTasks,
  gate,
  indexFixture,
} from '../helpers.js';

/**
 * Every error names the call the caller actually made, and the request that
 * failed when one did.
 *
 * `S3VectorsErrorContext.operation` is the one field always present, and the
 * contract is that it holds the name of the *public method the caller invoked*
 * — never the AWS command's, not even when an AWS request is what failed, and
 * never that of another public method the invoked one runs through, as a
 * retriever runs a search and a factory constructs a store and writes to it —
 * so a failure points at something the caller wrote. The request is a field of its own,
 * `awsCommand`: set on every error that wraps a failed AWS request, and absent
 * from every other. Both are easy to get wrong in a way nothing notices: the
 * strings are passed down through several layers, and a wrong one still
 * produces a perfectly plausible error.
 *
 * An already-fired signal is the cheapest way to make each method fail at its
 * own entry point, before any request. A mocked rejection of each command a
 * method issues is how it fails on each request.
 */
type Store = ReturnType<typeof createTestStore>['store'];
type Mock = ReturnType<typeof createTestStore>['mock'];

/** The fields under test, read without asserting the error's type first. */
const contextOf = (error: unknown): Record<string, unknown> =>
  (error as { context: Record<string, unknown> }).context;

const fired = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

const drain = async (iterator: AsyncGenerator<unknown>): Promise<void> => {
  for await (const _item of iterator) break;
};

/** What a synchronous call threw, or `undefined` when it returned. */
const captureSync = (call: () => unknown): unknown => {
  try {
    call();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
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
    // Refused before any request, so no request is named — and nothing but the
    // method and its target is: `deleteIndex`'s abort check once carried the
    // SDK client along with them.
    expect(Object.keys(contextOf(error)).sort()).toEqual([
      'indexName',
      'operation',
      'vectorBucketName',
    ]);
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
    // Exactly these: the index tracker's own context also holds the SDK client,
    // which must never reach an error a logger will render.
    expect(Object.keys(contextOf(error)).sort()).toEqual([
      'attemptedIds',
      'indexName',
      'operation',
      'vectorBucketName',
      'writtenIds',
    ]);
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
    // PutVectors, and the error would report a request that should never have
    // been issued.
    const { store, mock } = createTestStore({ createIndexIfNotExist: false });
    const error = await store
      .addVectors([[1, 2, 3]], [new Document({ pageContent: 'x' })], { signal: fired() })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: { operation: string } }).context.operation).toBe('addVectors');
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
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

/** What the SDK raises for a refused request: a declared exception name and its metadata. */
const denied = (): Error =>
  Object.assign(new Error('denied'), {
    name: 'AccessDeniedException',
    $metadata: { httpStatusCode: 403, requestId: 'req-d6' },
  });

const notFound = (): Error => Object.assign(new Error('not found'), { name: 'NotFoundException' });

const doc = (): Document => new Document({ pageContent: 'x' });

/**
 * Make one command fail, and every command a method issues before it succeed.
 *
 * `GetVectors` is reached by `getByIds` directly and by MMR after a search, so
 * its arrangement also gives that search a candidate to fetch.
 */
const FAIL: Record<string, (mock: Mock) => void> = {
  GetIndex: (mock) => {
    mock.on(GetIndexCommand).rejects(denied());
  },
  CreateIndex: (mock) => {
    mock.on(GetIndexCommand).rejects(notFound());
    mock.on(CreateIndexCommand).rejects(denied());
  },
  PutVectors: (mock) => {
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).rejects(denied());
  },
  DeleteVectors: (mock) => {
    mock.on(DeleteVectorsCommand).rejects(denied());
  },
  DeleteIndex: (mock) => {
    mock.on(DeleteIndexCommand).rejects(denied());
  },
  QueryVectors: (mock) => {
    mock.on(QueryVectorsCommand).rejects(denied());
  },
  GetVectors: (mock) => {
    mock.on(QueryVectorsCommand).resolves({ vectors: [{ key: 'id-1' }], distanceMetric: 'cosine' });
    mock.on(GetVectorsCommand).rejects(denied());
  },
  ListVectors: (mock) => {
    mock.on(ListVectorsCommand).rejects(denied());
  },
};

/** Every public method, against every AWS command it issues. */
const REQUEST_FAILURES: [string, string, (store: Store) => Promise<unknown>][] = [
  ['addVectors', 'GetIndex', (store) => store.addVectors([[1, 2, 3]], [doc()])],
  ['addVectors', 'CreateIndex', (store) => store.addVectors([[1, 2, 3]], [doc()])],
  ['addVectors', 'PutVectors', (store) => store.addVectors([[1, 2, 3]], [doc()])],
  ['addDocuments', 'GetIndex', (store) => store.addDocuments([doc()])],
  ['addDocuments', 'CreateIndex', (store) => store.addDocuments([doc()])],
  ['addDocuments', 'PutVectors', (store) => store.addDocuments([doc()])],
  ['delete', 'DeleteVectors', (store) => store.delete({ ids: ['a'] })],
  ['deleteIndex', 'DeleteIndex', (store) => store.deleteIndex()],
  ['getByIds', 'GetVectors', (store) => store.getByIds(['a'])],
  ['similaritySearch', 'QueryVectors', (store) => store.similaritySearch('q', 1)],
  ['similaritySearchWithScore', 'QueryVectors', (store) => store.similaritySearchWithScore('q', 1)],
  [
    'similaritySearchWithRelevanceScores',
    'QueryVectors',
    (store) => store.similaritySearchWithRelevanceScores('q', 1),
  ],
  [
    'similaritySearchVectorWithScore',
    'QueryVectors',
    (store) => store.similaritySearchVectorWithScore([1, 2, 3], 1),
  ],
  [
    'maxMarginalRelevanceSearch',
    'QueryVectors',
    (store) => store.maxMarginalRelevanceSearch('q', { k: 1 }),
  ],
  [
    'maxMarginalRelevanceSearch',
    'GetVectors',
    (store) => store.maxMarginalRelevanceSearch('q', { k: 1 }),
  ],
  // A listing issues ListVectors alone. Asking it for metadata needs the
  // s3vectors:GetVectors *permission*, but no GetVectors request is made.
  ['listDocuments', 'ListVectors', (store) => drain(store.listDocuments())],
  ['listVectors', 'ListVectors', (store) => drain(store.listVectors())],
];

describe('a failed AWS request names the public method and, separately, the request', () => {
  it('covers every AWS command this package issues', () => {
    expect(new Set(REQUEST_FAILURES.map(([, command]) => command))).toEqual(
      new Set(Object.keys(FAIL)),
    );
    expect(Object.keys(FAIL)).toHaveLength(8);
  });

  it.each(REQUEST_FAILURES)('%s, failing on %s', async (operation, command, run) => {
    const { store, mock } = createTestStore();
    FAIL[command]!(mock);
    const error = await run(store).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(contextOf(error)['operation']).toBe(operation);
    expect(contextOf(error)['awsCommand']).toBe(command);
    // Messages are not the contract, but a log line alone should say both.
    expect((error as Error).message).toContain(
      `${operation} failed on ${command} (AccessDeniedException`,
    );
  });

  it('an abort that cancels a request in flight names that request, since it is what stopped', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(DeleteVectorsCommand)
      .rejects(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
    const error = await store
      .delete({ ids: ['a'], signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect(contextOf(error)).toMatchObject({ operation: 'delete', awsCommand: 'DeleteVectors' });
  });

  it('a validation error names no request, because none was made', async () => {
    const { store, mock } = createTestStore();
    const error = await store.delete({ ids: [''] }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
    expect(mock.calls()).toHaveLength(0);
  });

  it('caller code that throws names no request, even when what it throws looks like an AWS error', async () => {
    // An AWS-SDK-based embeddings model can throw a declared exception name,
    // and that diagnostic is still reported — but no request of this store's
    // failed, so no command is named.
    const { client } = createMockClient();
    const embeddings = {
      ...createMockEmbeddings(),
      embedQuery: async (): Promise<number[]> => {
        throw denied();
      },
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const error = await store.similaritySearch('q', 1).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)).toMatchObject({
      operation: 'similaritySearch',
      awsErrorName: 'AccessDeniedException',
    });
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
  });

  it('a malformed response names no request: the request succeeded, the answer was wrong', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves(null as never);
    const error = await store.getByIds(['a']).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect(contextOf(error)['operation']).toBe('getByIds');
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
  });

  it('a creation rule refused at the index step names the write that needed the index', async () => {
    // The store refuses such a dimension before its index step is reached, so
    // the lifecycle is driven directly. It used to name `createIndex`, which is
    // neither a public method nor an AWS command.
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).rejects(notFound());
    const lifecycle = createIndexLifecycle(
      { client, ...BASE_CONFIG },
      { dataType: 'float32', distanceMetric: 'cosine', pageContentMetadataKey: '_page_content' },
    );
    const error = await lifecycle.ensureExists(0, undefined, 'addVectors').catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(contextOf(error)['operation']).toBe('addVectors');
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });
});

/** The stack frames under an error's header line, which a rebuilt error must keep. */
const framesOf = (error: unknown): string => {
  const stack = (error as Error).stack ?? '';
  return stack.slice(stack.indexOf('\n    at '));
};

describe('writes sharing one index check each name their own method', () => {
  // Concurrent writes share one GetIndex/CreateIndex sequence. Its failure is
  // raised once, under whichever write started it; every other write waiting
  // on it must still see its own method — with the same request, cause, class
  // and stack.
  it.each([
    [
      'GetIndex',
      (mock: Mock, held: Promise<void>): void => {
        mock.on(GetIndexCommand).callsFake(async () => {
          await held;
          throw denied();
        });
      },
    ],
    [
      'CreateIndex',
      (mock: Mock, held: Promise<void>): void => {
        mock.on(GetIndexCommand).rejects(notFound());
        mock.on(CreateIndexCommand).callsFake(async () => {
          await held;
          throw denied();
        });
      },
    ],
  ])('when the shared %s fails', async (command, arrange) => {
    const { store, mock } = createTestStore();
    const release = gate();
    arrange(mock, release.promise);

    const vectors = store.addVectors([[1, 2, 3]], [doc()]).catch((e: unknown) => e);
    const documents = store.addDocuments([doc()]).catch((e: unknown) => e);
    await drainTasks();
    release.open();
    const [fromVectors, fromDocuments] = await Promise.all([vectors, documents]);

    // One shared check, or this is not the case under test.
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    for (const [error, operation] of [
      [fromVectors, 'addVectors'],
      [fromDocuments, 'addDocuments'],
    ] as const) {
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
      expect(contextOf(error)).toMatchObject({ operation, awsCommand: command, ...BASE_CONFIG });
      expect((error as Error).message.startsWith(`${operation} failed on ${command} (`)).toBe(true);
    }
    expect((fromDocuments as Error).cause).toBe((fromVectors as Error).cause);
    expect(framesOf(fromDocuments)).toBe(framesOf(fromVectors));
  });

  it('when the index disagrees with the store, which no request failed to say', async () => {
    const { store, mock } = createTestStore();
    const release = gate();
    mock.on(GetIndexCommand).callsFake(async () => {
      await release.promise;
      return { index: indexFixture({ metadataConfiguration: undefined }) };
    });

    const vectors = store.addVectors([[1, 2, 3]], [doc()]).catch((e: unknown) => e);
    const documents = store.addDocuments([doc()]).catch((e: unknown) => e);
    await drainTasks();
    release.open();
    const [fromVectors, fromDocuments] = await Promise.all([vectors, documents]);

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    for (const [error, operation] of [
      [fromVectors, 'addVectors'],
      [fromDocuments, 'addDocuments'],
    ] as const) {
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
      expect(contextOf(error)['operation']).toBe(operation);
      expect(contextOf(error)).not.toHaveProperty('awsCommand');
    }
    expect((fromDocuments as Error).message).toBe((fromVectors as Error).message);
    expect(framesOf(fromDocuments)).toBe(framesOf(fromVectors));
  });

  it("gives a second method a copy, leaving the first caller's error as it was", async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).rejects(denied());
    const lifecycle = createIndexLifecycle(
      { client, ...BASE_CONFIG },
      { dataType: 'float32', distanceMetric: 'cosine', pageContentMetadataKey: '_page_content' },
    );

    // Started back to back, so all three wait on the one check.
    const first = lifecycle.ensureExists(3, undefined, 'addVectors').catch((e: unknown) => e);
    const same = lifecycle.ensureExists(3, undefined, 'addVectors').catch((e: unknown) => e);
    const other = lifecycle
      .ensureExists(3, new AbortController().signal, 'addDocuments')
      .catch((e: unknown) => e);
    const [a, sameMethod, b] = await Promise.all([first, same, other]);

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    // The same method needs nothing rebuilt.
    expect(sameMethod).toBe(a);
    expect(b).not.toBe(a);
    expect(contextOf(a)['operation']).toBe('addVectors');
    expect(contextOf(b)).toEqual({ ...contextOf(a), operation: 'addDocuments' });
    expect((b as { code?: string }).code).toBe((a as { code?: string }).code);
    expect((b as Error).cause).toBe((a as Error).cause);
    expect((b as Error).message).toBe(
      (a as Error).message.replace(/^addVectors failed/, 'addDocuments failed'),
    );
    expect(framesOf(b)).toBe(framesOf(a));
  });

  it("deleteIndex waiting on a write's failing check reports only its own request", async () => {
    const { store, mock } = createTestStore();
    const release = gate();
    mock.on(GetIndexCommand).callsFake(async () => {
      await release.promise;
      throw denied();
    });
    mock.on(DeleteIndexCommand).rejects(denied());

    const writing = store.addVectors([[1, 2, 3]], [doc()]).catch((e: unknown) => e);
    await drainTasks();
    const deleting = store.deleteIndex().catch((e: unknown) => e);
    release.open();
    const [fromWrite, fromDelete] = await Promise.all([writing, deleting]);

    expect(contextOf(fromWrite)).toMatchObject({ operation: 'addVectors', awsCommand: 'GetIndex' });
    expect(contextOf(fromDelete)).toMatchObject({
      operation: 'deleteIndex',
      awsCommand: 'DeleteIndex',
    });
  });
});

/** A callback handler that fails the way core lets one fail: `raiseError` rethrows it. */
class ThrowingHandler extends BaseCallbackHandler {
  name = 'throwing-handler';

  constructor() {
    super({ raiseError: true });
  }

  override handleRetrieverStart(): never {
    throw new Error('handler blew up');
  }
}

/** A store whose query model throws, as a provider outage does. */
const storeWithFailingModel = (): Store => {
  const { client } = createMockClient();
  return new AmazonS3Vectors(
    {
      ...createMockEmbeddings(),
      embedQuery: async (): Promise<number[]> => {
        throw new Error('provider down');
      },
    },
    { ...BASE_CONFIG, client },
  );
};

describe('a retriever invocation names itself, whatever fails underneath', () => {
  // A retriever is a public method of its own: whatever its search raises is
  // reported as `retriever.invoke`, with the request, class and cause intact.
  it.each([
    ['similarity', 'QueryVectors', {}],
    ['mmr', 'QueryVectors', { searchType: 'mmr' as const }],
    ['mmr', 'GetVectors', { searchType: 'mmr' as const }],
  ])('a %s retriever whose %s fails', async (_type, command, fields) => {
    const { store, mock } = createTestStore();
    FAIL[command]!(mock);
    const error = await store
      .asRetriever({ k: 1, ...fields })
      .invoke('q')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(contextOf(error)).toMatchObject({
      operation: 'retriever.invoke',
      awsCommand: command,
      ...BASE_CONFIG,
    });
    expect((error as Error).message.startsWith(`retriever.invoke failed on ${command} (`)).toBe(
      true,
    );
  });

  it.each([
    [
      // The retriever's own fields are checked when it is built (see below), so
      // what a search can still refuse here is what only running it reveals: a
      // query vector the model returned that no cosine index can search with.
      S3VectorsErrorCode.VALIDATION,
      (): Promise<unknown> => {
        const { client } = createMockClient();
        const zero = { ...createMockEmbeddings(), embedQuery: async () => [0, 0, 0] };
        return new AmazonS3Vectors(zero, { ...BASE_CONFIG, client }).asRetriever().invoke('q');
      },
    ],
    [
      S3VectorsErrorCode.EMBEDDINGS_MISSING,
      (): Promise<unknown> => {
        const { client } = createMockClient();
        return new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client }).asRetriever().invoke('q');
      },
    ],
    [
      S3VectorsErrorCode.UNEXPECTED_ERROR,
      (): Promise<unknown> => storeWithFailingModel().asRetriever().invoke('q'),
    ],
    [
      S3VectorsErrorCode.ABORTED,
      (): Promise<unknown> =>
        createTestStore().store.asRetriever({ k: 1, signal: fired() }).invoke('q'),
    ],
  ])('%s from the search underneath', async (code, run) => {
    const error = await run().catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(code);
    expect(contextOf(error)['operation']).toBe('retriever.invoke');
    expect(contextOf(error)).not.toHaveProperty('awsCommand');
  });

  it('a callback handler that throws reaches the caller coded, not raw', async () => {
    // Core rethrows a `raiseError` handler's own failure out of `invoke`: caller
    // code, and so UNEXPECTED_ERROR, with the handler's error as the cause.
    const { store, mock } = createTestStore();
    const error = await store
      .asRetriever({ k: 1, callbacks: [new ThrowingHandler()] })
      .invoke('q')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)).toMatchObject({ operation: 'retriever.invoke', ...BASE_CONFIG });
    expect(((error as Error).cause as Error).message).toBe('handler blew up');
    expect(mock.calls()).toHaveLength(0);
  });

  it("core's refusal of a non-positive timeout reaches the caller coded, not raw", async () => {
    const { store } = createTestStore();
    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q', { timeout: 0 })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)['operation']).toBe('retriever.invoke');
  });

  it('batch and stream run a failure from inside invoke through it, so they report it too', async () => {
    const { store, mock } = createTestStore();
    FAIL['QueryVectors']!(mock);
    const retriever = store.asRetriever({ k: 1 });

    const fromBatch = await retriever.batch(['q']).catch((e: unknown) => e);
    expect(contextOf(fromBatch)).toMatchObject({
      operation: 'retriever.invoke',
      awsCommand: 'QueryVectors',
    });

    const [returned] = await retriever.batch(['q'], undefined, { returnExceptions: true });
    expect(contextOf(returned)['operation']).toBe('retriever.invoke');

    const fromStream = await (async () => {
      for await (const _chunk of await retriever.stream('q')) break;
    })().catch((e: unknown) => e);
    expect(contextOf(fromStream)).toMatchObject({
      operation: 'retriever.invoke',
      awsCommand: 'QueryVectors',
    });
  });

  it("batch's own signal and timeout reach invoke, so their abort reports it", async () => {
    // Core's `batch` builds each input's config with `ensureConfig` and hands it
    // to `invoke` (`@langchain/core@1.2.11` `dist/runnables/base.js:77-84`,
    // `:88-94`), and `invoke` races that config's signal.
    const { store, mock } = createTestStore();
    const release = gate();
    mock.on(QueryVectorsCommand).callsFake(async () => {
      await release.promise;
      return { vectors: [], distanceMetric: 'cosine' };
    });
    const retriever = store.asRetriever({ k: 1 });

    const aborted = await retriever.batch(['q'], { signal: fired() }).catch((e: unknown) => e);
    const timedOut = await retriever.batch(['q'], { timeout: 20 }).catch((e: unknown) => e);
    release.open();

    for (const error of [aborted, timedOut]) {
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
      expect(contextOf(error)['operation']).toBe('retriever.invoke');
    }
    expect(((timedOut as Error).cause as Error).name).toBe('TimeoutError');
  });

  it("core's own refusals in batch and stream never reach invoke, and are core's raw errors", async () => {
    // Pinned so an upstream change surfaces here. `batch` and `stream` run
    // `ensureConfig` before `invoke` (`@langchain/core@1.2.11`
    // `dist/runnables/base.js:77-84`, `:121`), which throws for a non-positive
    // `timeout`; and `stream` races the config signal itself
    // (`dist/utils/stream.js:131-134`, through `raceWithSignal`, which rejects
    // with the signal's reason and discards `invoke`'s own rejection once the
    // signal has fired).
    const { store, mock } = createTestStore();
    const release = gate();
    mock.on(QueryVectorsCommand).callsFake(async () => {
      await release.promise;
      return { vectors: [], distanceMetric: 'cosine' };
    });
    const retriever = store.asRetriever({ k: 1 });
    const drainStream = (options: object): Promise<unknown> =>
      (async () => {
        for await (const _chunk of await retriever.stream('q', options)) break;
      })().catch((e: unknown) => e);

    const batchTimeoutZero = await retriever.batch(['q'], { timeout: 0 }).catch((e: unknown) => e);
    const streamTimeoutZero = await drainStream({ timeout: 0 });
    const controller = new AbortController();
    controller.abort('stopped by the caller');
    const streamFired = await drainStream({ signal: controller.signal });
    const streamTimedOut = await drainStream({ timeout: 20 });
    release.open();

    for (const error of [batchTimeoutZero, streamTimeoutZero]) {
      expect(isS3VectorsError(error)).toBe(false);
      expect((error as Error).message).toBe('Timeout must be a positive number');
    }
    // Core's `getAbortSignalError` passes an `Error` reason through and wraps a
    // string one (`dist/utils/signal.js`). A string reason is used for the fired
    // signal because the default `DOMException` fails core's `instanceof Error`
    // inside Jest's VM realm and comes back as `Error('Aborted')` — where, outside
    // it, the `AbortError` or `TimeoutError` itself is what the caller sees.
    expect(isS3VectorsError(streamFired)).toBe(false);
    expect((streamFired as Error).message).toBe('stopped by the caller');
    expect(isS3VectorsError(streamTimedOut)).toBe(false);
  });

  it('keeps the stack of the code that actually failed', async () => {
    const { store, mock } = createTestStore();
    FAIL['QueryVectors']!(mock);
    const error = await store
      .asRetriever({ k: 1 })
      .invoke('q')
      .catch((e: unknown) => e);
    const stack = String((error as Error).stack);
    expect(stack.startsWith('S3VectorsError: retriever.invoke failed on QueryVectors')).toBe(true);
    // Raised where the request failed; renaming it must not become its origin.
    // Files, not function names: coverage instrumentation shifts the names.
    expect(stack).toContain('query-pages.ts');
    expect(stack).toContain('wrap-error.ts');
    expect(stack).not.toContain('decorate.ts');
  });
});

describe("a retriever's other public methods name themselves", () => {
  it('asRetriever, for a field the retriever could never search with', () => {
    const { store } = createTestStore();
    const error = captureSync(() => store.asRetriever({ k: 0 }));
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(contextOf(error)).toEqual({ operation: 'asRetriever', ...BASE_CONFIG });
  });

  it('asRetriever, for a fields argument it cannot read at all', () => {
    const { store } = createTestStore();
    const error = captureSync(() => store.asRetriever(null as never));
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(contextOf(error)).toEqual({ operation: 'asRetriever', ...BASE_CONFIG });
  });

  it('the constructor, when a retriever is built directly', () => {
    const { store } = createTestStore();
    const error = captureSync(
      () => new AmazonS3VectorsRetriever({ vectorStore: store, signal: 'nope' as never }),
    );
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(contextOf(error)).toEqual({ operation: 'retriever.constructor', ...BASE_CONFIG });
    expect((error as Error).message.startsWith('retriever.constructor was given a `signal`')).toBe(
      true,
    );
  });

  it('retriever.addDocuments, rather than the store method it writes through', async () => {
    const { store, mock } = createTestStore();
    FAIL['PutVectors']!(mock);
    const error = await store
      .asRetriever()
      .addDocuments([doc()])
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(contextOf(error)).toMatchObject({
      operation: 'retriever.addDocuments',
      awsCommand: 'PutVectors',
      ...BASE_CONFIG,
    });
    expect(
      (error as Error).message.startsWith('retriever.addDocuments failed on PutVectors ('),
    ).toBe(true);
  });
});

describe('the static factories name themselves, whatever fails underneath', () => {
  it.each([
    [
      'fromDocuments',
      (config: object): Promise<unknown> =>
        AmazonS3Vectors.fromDocuments([doc()], createMockEmbeddings(), config as never),
    ],
    [
      'fromTexts',
      (config: object): Promise<unknown> =>
        AmazonS3Vectors.fromTexts(['x'], {}, createMockEmbeddings(), config as never),
    ],
  ])('%s, when the store cannot be constructed', async (operation, run) => {
    const { client, mock } = createMockClient();
    const error = await run({ ...BASE_CONFIG, client, distanceMetric: 'manhattan' }).catch(
      (e: unknown) => e,
    );
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(contextOf(error)['operation']).toBe(operation);
    expect(contextOf(error)).not.toHaveProperty('instance');
    expect(mock.calls()).toHaveLength(0);
  });

  it.each([
    [
      'fromDocuments',
      (client: object): Promise<unknown> =>
        AmazonS3Vectors.fromDocuments([doc()], createMockEmbeddings(), {
          ...BASE_CONFIG,
          client: client as never,
        }),
    ],
    [
      'fromTexts',
      (client: object): Promise<unknown> =>
        AmazonS3Vectors.fromTexts(['x'], {}, createMockEmbeddings(), {
          ...BASE_CONFIG,
          client: client as never,
        }),
    ],
  ])('%s, when its write fails', async (operation, run) => {
    const { client, mock } = createMockClient();
    FAIL['PutVectors']!(mock);
    const error = await run(client).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(contextOf(error)).toMatchObject({
      operation,
      awsCommand: 'PutVectors',
      writtenIds: [],
      ...BASE_CONFIG,
    });
    // The constructed store, for recovery — still a non-enumerable handle.
    expect((contextOf(error)['instance'] as AmazonS3Vectors).indexName).toBe(BASE_CONFIG.indexName);
    expect(Object.keys(contextOf(error))).not.toContain('instance');
    expect((error as Error).message.startsWith(`${operation} failed on PutVectors (`)).toBe(true);

    const stack = String((error as Error).stack);
    // Raised where the request failed; renaming it must not become its origin.
    // Files, not function names: coverage instrumentation shifts the names.
    expect(stack).toContain('put-batch.ts');
    expect(stack).toContain('wrap-error.ts');
    expect(stack).not.toContain('decorate.ts');
  });
});
