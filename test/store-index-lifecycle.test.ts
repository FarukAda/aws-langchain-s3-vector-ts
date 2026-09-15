import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  PutVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore, indexFixture, malformedIndexFixture } from './helpers.js';

/**
 * How the store uses the index lifecycle. These assert the behaviour that
 * replaced the index-configuration cache, and each is the negation of a test
 * the cache required — a write no longer pre-validates dimension or metric,
 * because AWS enforces the first and the read path verifies the second.
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;
const doc = (t: string): Document => new Document({ pageContent: t });

describe('store — index lifecycle', () => {
  it('does not pre-validate a dimension: the write reaches PutVectors and AWS decides', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture({ dimension: 5 }) });
    mock.on(PutVectorsCommand).rejects(awsError('ValidationException'));

    const error = await store
      .addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    // The old code never reached PutVectors, raising INDEX_CONFIG_MISMATCH from
    // cache instead. Now the write goes out and AWS's rejection carries its own
    // class.
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_REJECTED);
  });

  it('does not pre-validate a distance metric on the write path', async () => {
    const { store, mock } = createTestStore({ distanceMetric: 'cosine' });
    mock.on(GetIndexCommand).resolves({ index: indexFixture({ distanceMetric: 'euclidean' }) });
    mock.on(PutVectorsCommand).resolves({});

    await expect(store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] })).resolves.toEqual(['a']);
  });

  it('writes against a malformed GetIndex body, because existence is proven by the 200', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: malformedIndexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    await expect(store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] })).resolves.toEqual(['a']);
  });

  it('issues no GetIndex at all when createIndexIfNotExist is false', async () => {
    const { store, mock } = createTestStore({ createIndexIfNotExist: false });
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('checks existence once, then never again while it holds', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] });
    await store.addVectors([[4, 5, 6]], [doc('y')], { ids: ['b'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('re-checks after a PutVectors NotFoundException, and re-creates a missing index', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).rejectsOnce(awsError('NotFoundException')).resolves({});
    mock.on(CreateIndexCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] }).catch(() => undefined);

    // The index went away out of band, so the next write must re-check rather
    // than trust what it learned before.
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    await store.addVectors([[4, 5, 6]], [doc('y')], { ids: ['b'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('forgets existence after deleteIndex(), so the next write re-checks', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    await store.addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] });
    await store.deleteIndex();
    await store.addVectors([[4, 5, 6]], [doc('y')], { ids: ['b'] });

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('classifies a DeleteIndex failure rather than reporting a generic request failure', async () => {
    const { store, mock } = createTestStore();
    mock.on(DeleteIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await store.deleteIndex().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('still rejects a batch whose vectors disagree with each other, which is caller data', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors(
        [
          [1, 2, 3],
          [4, 5],
        ],
        [doc('x'), doc('y')],
        { ids: ['a', 'b'] },
      )
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });
});
