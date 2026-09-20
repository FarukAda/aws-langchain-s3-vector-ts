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
 * replaced the index-configuration cache, which went stale against an index
 * re-created out of band.
 *
 * The two halves of what that cache used to pre-validate are now decided
 * separately, and the difference is what each mismatch costs. A **dimension**
 * is still not pre-validated: AWS enforces it on every write and says so
 * plainly, and the vectors' dimension is only known once the embedding has
 * been paid for, so checking locally buys a round trip and nothing else. A
 * **metric** is, because it changes what this package itself does — the
 * cosine-only zero-norm rule in `limits.ts` reads the store's configured
 * metric — and because every other metric check lives on the read path, so a
 * write-only workload never saw the mismatch at all.
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

  it('refuses a write to an index whose distance metric is not the store’s', async () => {
    // This one *is* pre-validated, unlike the dimension below, and the reason
    // is that the metric changes what this package itself does rather than only
    // what AWS accepts: the cosine-only zero-norm rule in limits.ts is applied
    // from the store's configured metric. Every other metric check lives on the
    // read path, against a QueryVectors response, so before this a write-only
    // workload never caught the mismatch at all. The response is the one the
    // first write already makes, so it costs no extra request.
    const { store, mock } = createTestStore({ distanceMetric: 'cosine' });
    mock.on(GetIndexCommand).resolves({ index: indexFixture({ distanceMetric: 'euclidean' }) });
    mock.on(PutVectorsCommand).resolves({});

    const error = await store
      .addVectors([[1, 2, 3]], [doc('x')], { ids: ['a'] })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
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
