import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createTestStore } from './helpers.js';

/**
 * A read uses its inputs as they were when it checked them — the read-path half
 * of `write-input-snapshot.test.ts`.
 *
 * Every write copies its ids, documents and vectors on entry. The reads did
 * not: `getByIds` checked and fetched one list and then built its answer by
 * walking the caller's array again, after the request; a search checked a
 * filter and then sent the caller's own object, after the query had been
 * embedded. Both leave an `await` between the check and the use, and a caller
 * who reuses a buffer, or builds the next query's filter in the same object,
 * changes what happens on the far side of it without meaning to.
 */
describe('getByIds answers for the ids it was given', () => {
  const found = [
    { key: 'a', metadata: { _page_content: 'A' } },
    { key: 'b', metadata: { _page_content: 'B' } },
  ];

  it('keeps each document in the slot that asked for it when the caller reorders the list', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves({ vectors: found });
    const ids = ['a', 'b'];

    const pending = store.getByIds(ids);
    // Synchronous, so it lands after the list was checked and before the answer
    // is assembled.
    ids.reverse();

    expect((await pending).map((doc) => doc?.pageContent)).toEqual(['A', 'B']);
  });

  it('does not answer for an id it never asked AWS about', async () => {
    // A slot holding `undefined` means "AWS was asked, and this id is not
    // there". An id pushed on afterwards was never in any request, so reporting
    // it absent states something nobody checked.
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves({ vectors: found });
    const ids = ['a', 'b'];

    const pending = store.getByIds(ids);
    ids.push('never-requested');

    expect(await pending).toHaveLength(2);
  });

  it('still returns what it found when the caller empties the list', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves({ vectors: found });
    const ids = ['a', 'b'];

    const pending = store.getByIds(ids);
    ids.length = 0;

    expect((await pending).map((doc) => doc?.id)).toEqual(['a', 'b']);
  });
});

describe('a search sends the filter it checked', () => {
  it('is unaffected by the caller changing the filter while the query is being embedded', async () => {
    // AWS's whole diagnosis of a bad filter is the string "Invalid filter", so
    // one that reaches it unchecked is the most expensive kind of mistake to
    // debug — and one that is valid but different silently answers another
    // question.
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const range: Record<string, unknown> = { $gte: 2000 };
    const filter: Record<string, unknown> = { year: range };

    const pending = store.similaritySearch('q', 1, filter);
    range['$gte'] = 'not a number';
    filter['genre'] = 'a second condition, which one object may not hold';
    await pending;

    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.filter).toEqual({
      year: { $gte: 2000 },
    });
  });

  it('is unaffected inside a logical operator’s list too', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const branches: Record<string, unknown>[] = [{ genre: 'scifi' }, { tags: { $in: ['a', 'b'] } }];

    const pending = store.similaritySearch('q', 1, { $and: branches });
    branches.pop();
    await pending;

    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input.filter).toEqual({
      $and: [{ genre: 'scifi' }, { tags: { $in: ['a', 'b'] } }],
    });
  });

  it('does not change the filter it was given', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: 'cosine' });
    const filter = { $or: [{ genre: 'scifi' }, { year: { $lt: 1990 } }] };

    await store.similaritySearch('q', 1, filter);

    expect(filter).toEqual({ $or: [{ genre: 'scifi' }, { year: { $lt: 1990 } }] });
  });
});
