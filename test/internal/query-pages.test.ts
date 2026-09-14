import { QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { queryPages } from '../../src/internal/query-pages.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { createMockClient } from '../helpers.js';

/**
 * One test per domain cell of `queryPages` (docs/CONTRACTS-DRAFT.md,
 * "internal/query-pages").
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function setup() {
  const { client, mock } = createMockClient();
  const run = (overrides: Record<string, unknown> = {}): Promise<unknown> =>
    queryPages({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'similaritySearch',
      distanceMetric: 'cosine',
      k: 4,
      queryVector: [1, 2, 3],
      returnMetadata: true,
      returnDistance: true,
      ...overrides,
    });
  return { mock, run };
}

/** A page of `count` vectors, optionally with a continuation token. */
const page = (count: number, nextToken?: string, metric = 'cosine'): object => ({
  vectors: Array.from({ length: count }, (_, i) => ({
    key: `k${i}`,
    metadata: {},
    distance: 0.1,
  })),
  distanceMetric: metric,
  ...(nextToken === undefined ? {} : { nextToken }),
});

describe('queryPages', () => {
  it('returns a single page of results', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(page(2));
    expect(await run()).toHaveLength(2);
  });

  it('follows nextToken until k results are collected', async () => {
    const { mock, run } = setup();
    mock
      .on(QueryVectorsCommand)
      .resolvesOnce(page(2, 't1'))
      .resolvesOnce(page(2, 't2'))
      .resolves(page(2));
    expect(await run()).toHaveLength(4);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(2);
  });

  it('returns fewer than k without error when the token runs out, which a filter makes normal', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(page(1));
    expect(await run()).toHaveLength(1);
  });

  it('keeps paging through a long run of empty pages, because only an empty token ends a search', async () => {
    const { mock, run } = setup();
    let call = 0;
    mock.on(QueryVectorsCommand).callsFake(() => {
      call += 1;
      // Twelve empty-but-continuing pages: past the old ten-page streak guard.
      return call <= 12 ? page(0, `t${call}`) : page(4);
    });
    expect(await run()).toHaveLength(4);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(13);
  });

  it('fails closed when the page ceiling is reached with a token still outstanding', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).callsFake(() => page(0, 'always-more'));
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED);
  });

  it('truncates to k when a page overshoots', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(page(10));
    expect(await run({ k: 3 })).toHaveLength(3);
  });

  it('rejects a distance metric that disagrees with the store', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(page(1, undefined, 'euclidean'));
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
  });

  it('rejects an unrecognisable distance metric as a non-conforming response', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves({ vectors: [], distanceMetric: null as never });
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
  });

  it('checks the metric on the first page only, since an index cannot change it', async () => {
    const { mock, run } = setup();
    mock
      .on(QueryVectorsCommand)
      .resolvesOnce(page(1, 't1', 'cosine'))
      .resolves(page(3, undefined, 'euclidean'));
    await expect(run()).resolves.toHaveLength(4);
  });

  it('omits distance from the request when the caller does not want scores', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves({
      vectors: [{ key: 'a', metadata: {} }],
      distanceMetric: 'cosine',
    });
    const results = (await run({ returnDistance: false })) as { distance?: number }[];
    expect(results).toHaveLength(1);
    expect(results[0]?.distance).toBeUndefined();
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({
      returnDistance: false,
    });
  });

  it('explains a mid-pagination failure, where a continuation token may have expired', async () => {
    const { mock, run } = setup();
    mock
      .on(QueryVectorsCommand)
      .resolvesOnce(page(1, 't1'))
      .rejects(Object.assign(new Error('boom'), { name: 'ValidationException' }));
    const error = await run().catch((e: unknown) => e);
    expect((error as Error).message).toContain('page 2 of a paginated');
    expect((error as { context: { pagesScanned: number } }).context.pagesScanned).toBe(1);
  });

  it('leaves a first-page failure unexplained, since no token can have expired yet', async () => {
    const { mock, run } = setup();
    mock
      .on(QueryVectorsCommand)
      .rejects(Object.assign(new Error('boom'), { name: 'AccessDeniedException' }));
    const error = await run().catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('paginated');
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(page(1));
    const ac = new AbortController();
    ac.abort();
    const error = await run({ signal: ac.signal }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('keeps the frames of the call that actually failed', async () => {
    // The failure is decorated with pagination context. If the decorator kept
    // its own fresh stack instead of the original's frames, the reported
    // origin would be the decorator — hiding the one thing a stack is for.
    const { mock, run } = setup();
    const raised = new S3VectorsError('token expired', S3VectorsErrorCode.AWS_REQUEST_FAILED, {
      operation: 'similaritySearch',
    });
    raised.stack = 'S3VectorsError: token expired\n    at theRealThrowSite (file.ts:1:1)';
    mock.on(QueryVectorsCommand).resolvesOnce(page(1, 't1')).rejects(raised);

    const error = await run().catch((e: unknown) => e);
    const stack = String((error as Error).stack);
    expect(stack).toContain('theRealThrowSite');
    expect(stack.split('\n')[0]).toContain('page 2 of a paginated');
  });

  it.each([
    ['no stack at all', undefined],
    ['a stack in an unrecognised format', 'S3VectorsError: boom (no frames)'],
  ])(
    'decorates a mid-pagination failure cleanly when the error carries %s',
    async (_label, stack) => {
      const { mock, run } = setup();
      const odd = new S3VectorsError('boom', S3VectorsErrorCode.AWS_REQUEST_FAILED, {
        operation: 'similaritySearch',
      });
      odd.stack = stack;
      mock.on(QueryVectorsCommand).resolvesOnce(page(1, 't1')).rejects(odd);

      const error = await run().catch((e: unknown) => e);
      expect((error as Error).message).toContain('page 2 of a paginated');
      // Falling back means keeping the rebuilt error's *own* frames — not
      // splicing whatever the original held onto a header and calling it a
      // stack.
      expect((error as Error).stack).toContain('\n    at ');
    },
  );

  it('rejects a nullish response from a non-conforming client', async () => {
    const { mock, run } = setup();
    mock.on(QueryVectorsCommand).resolves(undefined as never);
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
  });
});
