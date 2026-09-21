import { describe, expect, it } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3VectorsRetriever } from '../src/retriever.js';
import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { flattenMetadata } from '../src/shared/flatten-metadata.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings, createTestStore } from './helpers.js';

/**
 * A getter is the caller's code, and it runs inside this package.
 *
 * Reading a property off anything a caller hands over — a document, its
 * metadata, a filter, an options bag, the configuration — runs whatever getter
 * is behind it, and a getter can throw: a lazily loaded ORM field whose session
 * has closed, a revoked `Proxy`, a config object that raises "missing
 * environment variable" on access. Those reads happen inside this package's own
 * validation, which had no `catch` around it, so the getter's error left every
 * public method of the store exactly as it was thrown — uncoded, with
 * `isS3VectorsError` reporting `false`, on the path whose whole job is to refuse
 * bad input by name.
 *
 * `asRetriever`, `retriever.invoke` and the two static factories already
 * normalised it, to `UNEXPECTED_ERROR` — "input malformed enough to bypass
 * validation", in the README's words. So the package had already decided what
 * this failure is; most of its surface just did not say so.
 */
const BOOM = 'the getter threw';

/** An object whose `name` property throws when it is read. */
const throwingOn = <T extends object>(target: T, name: string): T =>
  Object.defineProperty(target, name, {
    enumerable: true,
    get: (): never => {
      throw new Error(BOOM);
    },
  });

type Store = ReturnType<typeof createTestStore>['store'];

const drain = async (iterator: AsyncGenerator<unknown>): Promise<void> => {
  for await (const _item of iterator) break;
};

const CASES: readonly [operation: string, what: string, run: (store: Store) => Promise<unknown>][] =
  [
    [
      'addDocuments',
      "a document's pageContent",
      (store) => store.addDocuments([throwingOn({ metadata: {} }, 'pageContent') as never]),
    ],
    [
      'addDocuments',
      'a metadata value',
      (store) =>
        store.addDocuments([
          new Document({ pageContent: 'a', metadata: throwingOn({}, 'author') }),
        ]),
    ],
    [
      'addDocuments',
      "the options bag's ids",
      (store) => store.addDocuments([new Document({ pageContent: 'a' })], throwingOn({}, 'ids')),
    ],
    [
      'addVectors',
      "a document's pageContent",
      (store) =>
        store.addVectors([[1, 2, 3]], [throwingOn({ metadata: {} }, 'pageContent') as never]),
    ],
    [
      'addVectors',
      "the options bag's batchSize",
      (store) =>
        store.addVectors(
          [[1, 2, 3]],
          [new Document({ pageContent: 'a' })],
          throwingOn({}, 'batchSize'),
        ),
    ],
    ['delete', "the params' ids", (store) => store.delete(throwingOn({}, 'ids') as never)],
    [
      'deleteIndex',
      "the options bag's signal",
      (store) => store.deleteIndex(throwingOn({}, 'signal')),
    ],
    [
      'getByIds',
      "the options bag's batchSize",
      (store) => store.getByIds(['a'], throwingOn({}, 'batchSize')),
    ],
    [
      'similaritySearch',
      'a filter field',
      (store) => store.similaritySearch('q', 1, throwingOn({}, 'genre')),
    ],
    [
      'similaritySearchWithScore',
      'a filter field',
      (store) => store.similaritySearchWithScore('q', 1, throwingOn({}, 'genre')),
    ],
    [
      'similaritySearchWithRelevanceScores',
      'a filter field',
      (store) => store.similaritySearchWithRelevanceScores('q', 1, throwingOn({}, 'genre')),
    ],
    [
      'similaritySearchVectorWithScore',
      'a filter field',
      (store) => store.similaritySearchVectorWithScore([1, 2, 3], 1, throwingOn({}, 'genre')),
    ],
    [
      'maxMarginalRelevanceSearch',
      "the options' k",
      (store) => store.maxMarginalRelevanceSearch('q', throwingOn({}, 'k') as never),
    ],
    [
      'listDocuments',
      "the options bag's pageSize",
      (store) => drain(store.listDocuments(throwingOn({}, 'pageSize'))),
    ],
    [
      'listVectors',
      "the options bag's pageSize",
      (store) => drain(store.listVectors(throwingOn({}, 'pageSize'))),
    ],
  ];

describe('a getter that throws on caller-supplied input comes back coded', () => {
  it.each(CASES)('%s, reading %s', async (operation, _what, run) => {
    const { store, mock, embeddings } = createTestStore();

    const error = await run(store).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    const coded = error as S3VectorsError;
    expect(coded.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    // The method the caller invoked, and the index it was invoked on.
    expect(coded.context).toMatchObject({ operation, ...BASE_CONFIG });
    // What the getter threw is kept, not replaced.
    expect((coded.cause as Error).message).toBe(BOOM);
    // And it cost nothing: the read that threw comes before anything is spent.
    expect(mock.calls()).toHaveLength(0);
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('the constructor, reading an option out of the configuration', () => {
    const { client } = createMockClient();
    const config = throwingOn({ ...BASE_CONFIG, client }, 'distanceMetric');

    let error: unknown;
    try {
      new AmazonS3Vectors(undefined, config);
    } catch (thrown: unknown) {
      error = thrown;
    }

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect((error as S3VectorsError).context.operation).toBe('constructor');
    expect(((error as S3VectorsError).cause as Error).message).toBe(BOOM);
  });

  it('the constructor, reading the bucket name — which is read after every other option', () => {
    const { client } = createMockClient();
    const config = throwingOn({ indexName: BASE_CONFIG.indexName, client }, 'vectorBucketName');

    let error: unknown;
    try {
      new AmazonS3Vectors(undefined, config as AmazonS3VectorsConfig);
    } catch (thrown: unknown) {
      error = thrown;
    }

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect((error as S3VectorsError).context.operation).toBe('constructor');
  });

  // The factories read the configuration before the constructor does: the three
  // write options are taken out of it, and every option is read by name.
  it.each([
    ['a write option', 'ids'],
    ['a store option', 'distanceMetric'],
  ])('a static factory, reading %s out of its configuration', async (_what, option) => {
    const { client, mock } = createMockClient();
    const config = (): AmazonS3VectorsConfig => throwingOn({ ...BASE_CONFIG, client }, option);

    const errors = await Promise.all([
      AmazonS3Vectors.fromTexts(['a'], {}, createMockEmbeddings(3), config()).catch(
        (e: unknown) => e,
      ),
      AmazonS3Vectors.fromDocuments(
        [new Document({ pageContent: 'a' })],
        createMockEmbeddings(3),
        config(),
      ).catch((e: unknown) => e),
    ]);

    expect(errors.map((error) => isS3VectorsError(error) && error.code)).toEqual([
      S3VectorsErrorCode.UNEXPECTED_ERROR,
      S3VectorsErrorCode.UNEXPECTED_ERROR,
    ]);
    expect(errors.map((error) => (error as S3VectorsError).context.operation)).toEqual([
      'fromTexts',
      'fromDocuments',
    ]);
    expect(errors.map((error) => ((error as S3VectorsError).cause as Error).message)).toEqual([
      BOOM,
      BOOM,
    ]);
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('what the boundary does not touch', () => {
  it('leaves an error this package raised exactly as it was, the same object', async () => {
    // The layer nearest a failure owns its message and its class. A boundary
    // that rebuilt every error passing through it would cost each one its
    // identity for nothing: it already names this method.
    const { store } = createTestStore();
    const first = await store.getByIds('nope' as never).catch((e: unknown) => e);
    expect((first as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((first as S3VectorsError).context.operation).toBe('getByIds');
    expect((first as S3VectorsError).message).toBe('ids must be an array.');
  });
});

describe('the one published function that is not a method on the store', () => {
  it('flattenMetadata comes back coded when an accessor on the metadata throws', () => {
    // This table is what makes the invariant a rule rather than a habit, and
    // `flattenMetadata` was missing from it — so the only published function
    // that reads a caller's object without a store around it was also the only
    // one that let the read's failure out raw.
    let error: unknown;
    try {
      flattenMetadata(throwingOn({ source: 'report.pdf' }, 'body'));
    } catch (thrown: unknown) {
      error = thrown;
    }
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    // No bucket or index: this function is not bound to an index.
    expect((error as S3VectorsError).context.operation).toBe('flattenMetadata');
    expect(((error as S3VectorsError).cause as Error).message).toBe(BOOM);
  });
});

describe('the retriever, constructed directly rather than through asRetriever', () => {
  it.each(['k', 'filter', 'searchType', 'signal'])(
    'comes back coded when reading fields.%s throws',
    (field) => {
      const { store } = createTestStore();
      let error: unknown;
      try {
        new AmazonS3VectorsRetriever(throwingOn({ vectorStore: store }, field));
      } catch (thrown: unknown) {
        error = thrown;
      }
      expect(isS3VectorsError(error)).toBe(true);
      expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
      expect((error as S3VectorsError).context.operation).toBe('retriever.constructor');
    },
  );

  it("comes back coded when a getter inside a field throws — a filter's own", () => {
    // The fields are copied once, shallowly, so this getter runs later: in the
    // checks the constructor applies to the filter it was given.
    const { store } = createTestStore();
    let error: unknown;
    try {
      new AmazonS3VectorsRetriever({ vectorStore: store, filter: throwingOn({}, 'genre') });
    } catch (thrown: unknown) {
      error = thrown;
    }
    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect((error as S3VectorsError).context).toMatchObject({
      operation: 'retriever.constructor',
      ...BASE_CONFIG,
    });
  });
});
