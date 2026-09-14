import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { indexExists } from '../../src/internal/index-lifecycle.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import {
  createMockClient,
  indexFixture,
  malformedIndexFixture,
  sendOptionsOf,
} from '../helpers.js';

/**
 * One test per domain cell of `indexExists` (docs/CONTRACTS-DRAFT.md,
 * "internal/index-lifecycle").
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });

function ctxWith(): ReturnType<typeof createMockClient> & {
  ctx: {
    client: ReturnType<typeof createMockClient>['client'];
    vectorBucketName: string;
    indexName: string;
  };
} {
  const { client, mock } = createMockClient();
  return {
    client,
    mock,
    ctx: { client, vectorBucketName: 'test-bucket', indexName: 'test-index' },
  };
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

describe('indexExists', () => {
  it('returns true when GetIndex resolves', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    await expect(indexExists(ctx)).resolves.toBe(true);
  });

  it('returns false when GetIndex reports the index missing', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    await expect(indexExists(ctx)).resolves.toBe(false);
  });

  it('returns true for a response body missing dimension and metric, because existence is proven by the 200 and no field is read', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: malformedIndexFixture() });
    await expect(indexExists(ctx)).resolves.toBe(true);
  });

  it('returns true for a response with no index member at all', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({});
    await expect(indexExists(ctx)).resolves.toBe(true);
  });

  it('classifies an access failure as ACCESS_DENIED', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await indexExists(ctx).catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('classifies a throttle as THROTTLED, not as a generic request failure', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('TooManyRequestsException'));
    const error = await indexExists(ctx).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.THROTTLED);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    const ac = new AbortController();
    ac.abort();
    const error = await indexExists(ctx, ac.signal).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });

  it('threads the signal into the AWS request so an abort in flight cancels it', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    const ac = new AbortController();
    await indexExists(ctx, ac.signal);
    const call = mock.commandCalls(GetIndexCommand)[0]!;
    expect(sendOptionsOf(call)?.abortSignal).toBe(ac.signal);
  });

  it('names the bucket and index in a failure, so the error identifies what was queried', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await indexExists(ctx).catch((e: unknown) => e);
    const context = (error as { context?: Record<string, unknown> }).context;
    expect(context?.['vectorBucketName']).toBe('test-bucket');
    expect(context?.['indexName']).toBe('test-index');
  });
});
