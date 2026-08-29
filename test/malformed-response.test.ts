import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore } from './helpers.js';

/**
 * `_send` wraps only the AWS call itself, so every property read on a
 * resolved response happens outside its catch. A client that resolves with
 * a nullish response — a mock, a stub, an incompatible SDK version, a custom
 * transport — must still fail as a coded S3VectorsError rather than a raw,
 * uncoded TypeError, matching how this library treats every other
 * non-conforming-response case.
 */
describe('AmazonS3Vectors — a nullish AWS response is a coded error, not a TypeError', () => {
  it('rejects a nullish QueryVectors response with AWS_INVALID_RESPONSE', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves(undefined as never);

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 4)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
    expect((error as Error).message).toContain('QueryVectors');
    expect((error as Error).message).toContain('without a response object');
    expect((error as Error).name).toBe('S3VectorsError');
  });

  it('rejects a null QueryVectors response the same way', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).resolves(null as never);

    const error = await store.similaritySearchByVector([1, 2, 3], 4).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
  });

  it('rejects a nullish GetVectors response with AWS_INVALID_RESPONSE', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).resolves(undefined as never);

    const error = await store.getByIds(['id-1']).catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    );
    expect((error as Error).message).toContain('GetVectors');
  });
});

/**
 * AWS documents QueryVectors pagination tokens as valid for only "several
 * minutes", with re-issuing the original query as the remedy, and publishes
 * no dedicated expired-token exception. A failure on a continuation page is
 * therefore diagnosed from what this library knows for certain — that the
 * failing call carried a nextToken — rather than from an exception name.
 */
describe('AmazonS3Vectors — a mid-pagination QueryVectors failure explains itself', () => {
  it('adds pagination context when a continuation page fails', async () => {
    const { store, mock } = createTestStore();

    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({
        distanceMetric: 'cosine',
        vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
        nextToken: 'page-2',
      })
      .rejects(
        Object.assign(new Error('The pagination token is not valid.'), {
          name: 'ValidationException',
        }),
      );

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 50)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
    expect((error as Error).message).toContain('page 2 of a paginated');
    expect((error as Error).message).toContain('re-issue the original query');
    expect(
      (error as { context: { pagesScanned: number; resultsCollected: number } }).context,
    ).toMatchObject({ pagesScanned: 1, resultsCollected: 1 });
  });

  it('leaves a first-page failure unchanged — no token can have expired yet', async () => {
    const { store, mock } = createTestStore();
    mock.on(QueryVectorsCommand).rejects(new Error('boom'));

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 50)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(
      S3VectorsErrorCode.AWS_REQUEST_FAILED,
    );
    expect((error as Error).message).not.toContain('paginated');
  });

  it('leaves an aborted continuation unchanged — the caller cancelled, nothing to re-issue', async () => {
    const { store, mock } = createTestStore();

    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({
        distanceMetric: 'cosine',
        vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
        nextToken: 'page-2',
      })
      .rejects(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 50)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as Error).message).not.toContain('re-issue the original query');
  });
});
