import {
  DeleteIndexCommand,
  DeleteVectorsCommand,
  GetVectorsCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { createTestStore, mockExistingIndex } from './helpers.js';

/**
 * A method that takes an options bag refuses one that is not an object.
 *
 * `assertOptionsBag` was written for this and applied to `addVectors` alone,
 * so seven of the eight methods that take a bag read a non-object one as an
 * absent one — every option in it silently unset. That is the failure the
 * helper's own comment describes, and it is not theoretical: `deleteIndex` with
 * a string in the options position destroyed the index with the caller's abort
 * signal dropped, `addDocuments(docs, ids)` with the ids array in the bag's
 * place wrote generated UUIDs nobody could reconcile afterwards, and
 * `maxMarginalRelevanceSearch('q', 5)` — a plausible misreading of an API where
 * `similaritySearch('q', 5)` is correct — ran with `k` defaulted to 4 and
 * returned four documents as though that had been asked for.
 *
 * Passing `undefined` or `null` still means "no options", which is what
 * `assertOptionsBag` has always said and what every caller with an optional bag
 * relies on.
 */
describe('a non-object options bag is refused, not read as absent', () => {
  // A bag is "not an object" in several ways, and a caller reaches each by a
  // different mistake: an argument in the wrong position, a stray count, an
  // array where a bag belongs.
  const NOT_BAGS: readonly [string, unknown][] = [
    ['a string', 'no-options'],
    ['a number', 5],
    ['a boolean', true],
  ];

  const expectRefusal = async (operation: string, run: () => Promise<unknown>): Promise<void> => {
    let thrown: unknown;
    try {
      await run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(S3VectorsError);
    const error = thrown as S3VectorsError;
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.context.operation).toBe(operation);
    expect(error.message).toMatch(/options argument must be an object/);
  };

  describe.each(NOT_BAGS)('given %s', (_label, bag) => {
    it('addVectors refuses it before any AWS call', async () => {
      const { store, mock } = createTestStore();
      mockExistingIndex(mock);
      await expectRefusal('addVectors', () =>
        store.addVectors(
          [[1, 2, 3]],
          [{ pageContent: 'a', metadata: {} }],
          bag as Parameters<typeof store.addVectors>[2],
        ),
      );
      expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
    });

    it('addDocuments refuses it before embedding or writing', async () => {
      const { store, mock, embeddings } = createTestStore();
      mockExistingIndex(mock);
      await expectRefusal('addDocuments', () =>
        store.addDocuments(
          [{ pageContent: 'a', metadata: {} }],
          bag as Parameters<typeof store.addDocuments>[1],
        ),
      );
      expect(embeddings.embedDocuments).not.toHaveBeenCalled();
      expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
    });

    it('getByIds refuses it before any AWS call', async () => {
      const { store, mock } = createTestStore();
      await expectRefusal('getByIds', () =>
        store.getByIds(['a'], bag as Parameters<typeof store.getByIds>[1]),
      );
      expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
    });

    it('delete refuses it before any AWS call', async () => {
      const { store, mock } = createTestStore();
      await expectRefusal('delete', () => store.delete(bag as Parameters<typeof store.delete>[0]));
      expect(mock.commandCalls(DeleteVectorsCommand)).toHaveLength(0);
    });

    it('deleteIndex refuses it rather than destroying the index', async () => {
      const { store, mock } = createTestStore();
      await expectRefusal('deleteIndex', () =>
        store.deleteIndex(bag as Parameters<typeof store.deleteIndex>[0]),
      );
      expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(0);
    });

    it('maxMarginalRelevanceSearch refuses it before the billable embedQuery', async () => {
      const { store, mock, embeddings } = createTestStore();
      await expectRefusal('maxMarginalRelevanceSearch', () =>
        store.maxMarginalRelevanceSearch(
          'q',
          bag as Parameters<typeof store.maxMarginalRelevanceSearch>[1],
        ),
      );
      expect(embeddings.embedQuery).not.toHaveBeenCalled();
      expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
    });

    it('listDocuments refuses it on the first next(), before any AWS call', async () => {
      const { store, mock } = createTestStore();
      await expectRefusal('listDocuments', () =>
        store.listDocuments(bag as Parameters<typeof store.listDocuments>[0]).next(),
      );
      expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(0);
    });

    it('listVectors refuses it on the first next(), before any AWS call', async () => {
      const { store, mock } = createTestStore();
      await expectRefusal('listVectors', () =>
        store.listVectors(bag as Parameters<typeof store.listVectors>[0]).next(),
      );
      expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(0);
    });
  });

  it('an enumeration refusal is catchable by a try around the loop', async () => {
    // The reason both list methods are generators rather than methods that
    // return one: a synchronous throw would escape this `try`, while an
    // out-of-range `pageSize` would not, and the two would need different
    // handling for the same class of mistake.
    const { store } = createTestStore();
    let caught: unknown;
    try {
      for await (const _ of store.listDocuments(
        'nope' as unknown as Parameters<typeof store.listDocuments>[0],
      ))
        void _;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(S3VectorsError);
  });

  describe('absence still means absence', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('%s is accepted as "no options" by listDocuments', async (_label, bag) => {
      const { store, mock } = createTestStore();
      mock.on(ListVectorsCommand).resolves({ vectors: [] });
      const first = await store
        .listDocuments(bag as Parameters<typeof store.listDocuments>[0])
        .next();
      expect(first.done).toBe(true);
      expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(1);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('%s is accepted as "no options" by deleteIndex', async (_label, bag) => {
      const { store, mock } = createTestStore();
      mock.on(DeleteIndexCommand).resolves({});
      await store.deleteIndex(bag as Parameters<typeof store.deleteIndex>[0]);
      expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
    });
  });
});
