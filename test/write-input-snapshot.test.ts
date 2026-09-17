import { PutVectorsCommand, type S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { beforeEach, describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { AwsClientStub } from 'aws-sdk-client-mock';

import type { AmazonS3Vectors } from '../src/s3-vectors.js';
import { createTestStore, mockExistingIndex } from './helpers.js';

/**
 * A write reads its inputs once, at the start (F-04).
 *
 * The id list is resolved and validated up front — uniqueness, length, type —
 * and then each batch re-reads the caller's own array, lazily, as it is
 * dispatched. So the guarantee the validation provides only holds for as long
 * as the caller leaves the array alone, which nothing said and nothing checked.
 *
 * Mutating it while the promise is pending writes keys that were never
 * validated: duplicates, which S3 Vectors accepts and resolves by silently
 * overwriting the earlier vector, or `undefined`. The audit reproduced both —
 * `PutVectors keys=[["a"],["SWAPPED"],["SWAPPED"]]` for a reassignment, and
 * `[["a"],[undefined],[undefined]]` for an emptied array, the second returning
 * `[]` as though nothing had been written.
 *
 * This is not a hypothetical. A caller that reuses one buffer across batches,
 * or hands the same array to two concurrent writes, does this without ever
 * meaning to.
 */

function keysSent(mock: AwsClientStub<S3VectorsClient>): string[][] {
  return mock
    .commandCalls(PutVectorsCommand)
    .map((call) => (call.args[0].input.vectors ?? []).map((vector) => vector.key as string));
}

function vectorsSent(mock: AwsClientStub<S3VectorsClient>): number[][][] {
  return mock
    .commandCalls(PutVectorsCommand)
    .map((call) =>
      (call.args[0].input.vectors ?? []).map((vector) => vector.data?.float32 as number[]),
    );
}

function documentsFor(count: number): Document[] {
  return Array.from({ length: count }, (_, i) => new Document({ pageContent: `doc ${i}` }));
}

function vectorsFor(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => [i + 0.1, i + 0.2, i + 0.3]);
}

describe('a write is unaffected by mutating its inputs while it runs', () => {
  let store: AmazonS3Vectors;
  let mock: AwsClientStub<S3VectorsClient>;

  beforeEach(() => {
    ({ store, mock } = createTestStore());
    mockExistingIndex(mock);
  });

  it('addVectors writes the ids it validated, not the ones the caller later set', async () => {
    const ids = ['a', 'b', 'c'];
    const pending = store.addVectors(vectorsFor(3), documentsFor(3), { ids, batchSize: 1 });
    // Synchronous, so it lands before any batch after the first is sliced.
    ids[1] = 'SWAPPED';
    ids[2] = 'SWAPPED';

    const returned = await pending;

    expect(keysSent(mock)).toEqual([['a'], ['b'], ['c']]);
    expect(returned).toEqual(['a', 'b', 'c']);
  });

  it('addVectors survives the caller emptying the id array mid-flight', async () => {
    const ids = ['a', 'b', 'c'];
    const pending = store.addVectors(vectorsFor(3), documentsFor(3), { ids, batchSize: 1 });
    ids.length = 0;

    const returned = await pending;

    expect(keysSent(mock)).toEqual([['a'], ['b'], ['c']]);
    expect(returned).toEqual(['a', 'b', 'c']);
  });

  it('addVectors survives the caller emptying the document array mid-flight', async () => {
    const documents = documentsFor(3);
    const pending = store.addVectors(vectorsFor(3), documents, { batchSize: 1 });
    documents.length = 0;

    await expect(pending).resolves.toHaveLength(3);
    expect(keysSent(mock).flat()).toHaveLength(3);
  });

  it('addVectors writes the vectors it validated when the caller replaces one mid-flight', async () => {
    const vectors = vectorsFor(3);
    const pending = store.addVectors(vectors, documentsFor(3), { batchSize: 1 });
    // Synchronous, so it lands after the list was checked and before the third
    // batch is sliced — a vector the check would have refused, had it seen it.
    vectors[2] = [Number.NaN, 0, 0];

    await expect(pending).resolves.toHaveLength(3);
    expect(vectorsSent(mock)).toEqual(vectorsFor(3).map((vector) => [vector]));
  });

  it('addDocuments writes the ids it validated', async () => {
    const ids = ['a', 'b', 'c'];
    const pending = store.addDocuments(documentsFor(3), { ids, batchSize: 1 });
    ids[1] = 'SWAPPED';
    ids[2] = 'SWAPPED';

    const returned = await pending;

    expect(keysSent(mock)).toEqual([['a'], ['b'], ['c']]);
    expect(returned).toEqual(['a', 'b', 'c']);
  });

  it('returns its own array, so the caller cannot alter the report either', async () => {
    const ids = ['a', 'b'];
    const returned = await store.addVectors(vectorsFor(2), documentsFor(2), { ids });

    expect(returned).toEqual(['a', 'b']);
    // The returned list is the record of what was written. Handing back the
    // caller's own instance means a later mutation rewrites history, and means
    // two writes given the same array share one result.
    expect(returned).not.toBe(ids);
  });

  it('does not mutate the arrays it was given', async () => {
    const ids = ['a', 'b'];
    const documents = documentsFor(2);
    const vectors = vectorsFor(2);

    await store.addVectors(vectors, documents, { ids });

    expect(ids).toEqual(['a', 'b']);
    expect(documents).toHaveLength(2);
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [1.1, 1.2, 1.3],
    ]);
  });
});
