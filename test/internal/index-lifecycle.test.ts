import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { describeIndex } from '../../src/internal/index-lifecycle.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import {
  createMockClient,
  indexFixture,
  malformedIndexFixture,
  sendOptionsOf,
} from '../helpers.js';

/**
 * One test per domain cell of `describeIndex`.
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

describe('describeIndex', () => {
  it('returns true when GetIndex resolves', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    await expect(describeIndex(ctx)).resolves.toMatchObject({ exists: true });
  });

  it('returns false when GetIndex reports the index missing', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    await expect(describeIndex(ctx)).resolves.toMatchObject({ exists: false });
  });

  it('returns true for a response body missing dimension and metric, because existence is proven by the 200 and no field is read', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: malformedIndexFixture() });
    await expect(describeIndex(ctx)).resolves.toMatchObject({ exists: true });
  });

  it('returns true for a response with no index member at all', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({});
    await expect(describeIndex(ctx)).resolves.toMatchObject({ exists: true });
  });

  it('classifies an access failure as ACCESS_DENIED', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await describeIndex(ctx).catch((e: unknown) => e);
    expect(isS3VectorsError(error)).toBe(true);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('classifies a throttle as THROTTLED, not as a generic request failure', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('TooManyRequestsException'));
    const error = await describeIndex(ctx).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.THROTTLED);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    const ac = new AbortController();
    ac.abort();
    const error = await describeIndex(ctx, ac.signal).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });

  it('threads the signal into the AWS request so an abort in flight cancels it', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    const ac = new AbortController();
    await describeIndex(ctx, ac.signal);
    const call = mock.commandCalls(GetIndexCommand)[0]!;
    expect(sendOptionsOf(call)?.abortSignal).toBe(ac.signal);
  });

  it('names the bucket and index in a failure, so the error identifies what was queried', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await describeIndex(ctx).catch((e: unknown) => e);
    const context = (error as { context?: Record<string, unknown> }).context;
    expect(context?.['vectorBucketName']).toBe('test-bucket');
    expect(context?.['indexName']).toBe('test-index');
  });
});

/**
 * What `describeIndex` reports about an index's non-filterable keys.
 *
 * The distinction that matters is `[]` against `undefined`. AWS omits
 * `metadataConfiguration` entirely for an index that has no non-filterable keys
 * — probed live — so on a readable body its absence *states* that there are
 * none, and a store expecting some must be told. A body this package cannot
 * read states nothing, and must never be turned into a configuration verdict:
 * a stubbed client would otherwise manufacture a mismatch out of its own
 * silence.
 */
describe('describeIndex reports the index configuration it can actually read', () => {
  const keysFor = async (index: unknown): Promise<readonly string[] | undefined> => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves({ index } as { index?: never });
    return (await describeIndex(ctx)).nonFilterableKeys;
  };

  it('reports the keys an index declares', async () => {
    await expect(
      keysFor(indexFixture({ metadataConfiguration: { nonFilterableMetadataKeys: ['a', 'b'] } })),
    ).resolves.toEqual(['a', 'b']);
  });

  it('reports none for a readable index that omits the configuration', async () => {
    await expect(keysFor(indexFixture({ metadataConfiguration: undefined }))).resolves.toEqual([]);
  });

  it('reports none for a configuration that names no keys', async () => {
    await expect(
      keysFor(indexFixture({ metadataConfiguration: { nonFilterableMetadataKeys: undefined } })),
    ).resolves.toEqual([]);
  });

  it.each([
    ['no index member at all', undefined],
    ['an index that is not an object', 'an index, honestly'],
    ['an index without the required indexName', { dimension: 3 }],
    ['a configuration that is not an object', { ...indexFixture(), metadataConfiguration: 7 }],
    [
      'a key list that is not an array',
      { ...indexFixture(), metadataConfiguration: { nonFilterableMetadataKeys: 'a,b' } },
    ],
    [
      'a key list holding something other than strings',
      { ...indexFixture(), metadataConfiguration: { nonFilterableMetadataKeys: ['a', 7] } },
    ],
  ])('states nothing for %s', async (_label, index) => {
    await expect(keysFor(index)).resolves.toBeUndefined();
  });

  it('states nothing when the client resolves without a response object', async () => {
    const { mock, ctx } = ctxWith();
    mock.on(GetIndexCommand).resolves(undefined as unknown as { index?: never });
    const description = await describeIndex(ctx);
    expect(description.exists).toBe(true);
    expect(description.nonFilterableKeys).toBeUndefined();
  });
});
