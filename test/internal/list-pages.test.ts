import { ListVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { listPages } from '../../src/internal/list-pages.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of `listPages`. AWS caps a page at 1 MB regardless
 * of `maxResults`, so a short page is normal and only an empty `nextToken`
 * ends a listing (API ref API_S3VectorBuckets_ListVectors.html).
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function setup() {
  const { client, mock } = createMockClient();
  const run = (overrides: Record<string, unknown> = {}) =>
    listPages({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'listDocuments',
      returnData: false,
      returnMetadata: true,
      ...overrides,
    });
  const collect = async (overrides: Record<string, unknown> = {}): Promise<string[]> => {
    const keys: string[] = [];
    for await (const vector of run(overrides)) keys.push(vector.key);
    return keys;
  };
  return { mock, run, collect };
}

const page = (keys: string[], nextToken?: string): object => ({
  vectors: keys.map((key) => ({ key, metadata: { key } })),
  ...(nextToken === undefined ? {} : { nextToken }),
});

describe('listPages', () => {
  it('yields every vector across every page', async () => {
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce(page(['a', 'b'], 't1'))
      .resolvesOnce(page(['c'], 't2'))
      .resolves(page(['d']));
    expect(await collect()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps going through a short page, since the 1 MB cap makes short pages normal', async () => {
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce(page(['a'], 't1'))
      .resolves(page(Array.from({ length: 5 }, (_, i) => `k${i}`)));
    expect(await collect({ pageSize: 500 })).toHaveLength(6);
  });

  it('keeps going through an empty page that still carries a token', async () => {
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce(page([], 't1'))
      .resolves(page(['a']));
    expect(await collect()).toEqual(['a']);
  });

  it('treats an absent vectors field as an empty page, which the SDK type allows', async () => {
    // `ListVectorsOutput.vectors` is declared `ListOutputVector[] | undefined`
    // (`@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/models_0.d.ts:642`),
    // so a response object without it is representable and must not throw.
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce({ nextToken: 't1' })
      .resolves(page(['a']));
    expect(await collect()).toEqual(['a']);
  });

  it('ends on an empty token, yielding nothing further', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page([]));
    expect(await collect()).toEqual([]);
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(1);
  });

  it('omits maxResults when no page size is given, leaving the service default', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    await collect();
    expect(mock.commandCalls(ListVectorsCommand)[0]!.args[0].input).not.toHaveProperty(
      'maxResults',
    );
  });

  it('sends the page size the caller asked for', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    await collect({ pageSize: 250 });
    expect(mock.commandCalls(ListVectorsCommand)[0]!.args[0].input).toMatchObject({
      maxResults: 250,
    });
  });

  it('names the page-size range and what it got', async () => {
    const { collect } = setup();
    const error = await collect({ pageSize: 0 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'pageSize must be an integer between 1 and 1000 (received 0).',
    );
  });

  it.each([0, -1, 1001, 1.5])('rejects a page size of %p before any request', async (pageSize) => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    const error = await collect({ pageSize }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(0);
  });

  it.each([1, 1000])('accepts the boundary page size %p', async (pageSize) => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    await expect(collect({ pageSize })).resolves.toEqual(['a']);
  });

  it('issues no further request once the consumer stops iterating', async () => {
    const { mock, run } = setup();
    mock.on(ListVectorsCommand).callsFake(() => page(['a'], 'always-more'));
    for await (const _vector of run()) break;
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(1);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    const ac = new AbortController();
    ac.abort();
    const error = await collect({ signal: ac.signal }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(0);
  });

  it('threads the signal into every page request', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(page(['a']));
    const ac = new AbortController();
    await collect({ signal: ac.signal });
    expect(sendOptionsOf(mock.commandCalls(ListVectorsCommand)[0]!)?.abortSignal).toBe(ac.signal);
  });

  it('explains a 403, which is what a missing s3vectors:GetVectors permission produces', async () => {
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const error = await collect().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect((error as Error).message).toContain(
      'Listing with metadata or data requires the s3vectors:GetVectors permission in ' +
        'addition to s3vectors:ListVectors.',
    );
  });

  it('reports how far it got when a later page fails, since yielded items are already consumed', async () => {
    const { mock, collect } = setup();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce(page(['a', 'b'], 't1'))
      .rejects(Object.assign(new Error('boom'), { name: 'ServiceUnavailableException' }));
    const error = await collect().catch((e: unknown) => e);
    const context = (error as { context: Record<string, unknown> }).context;
    expect(context['pagesScanned']).toBe(1);
    expect(context['yielded']).toBe(2);
  });

  it('rejects a nullish response from a non-conforming client', async () => {
    const { mock, collect } = setup();
    mock.on(ListVectorsCommand).resolves(undefined as never);
    const error = await collect().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect((error as Error).message).toContain(
      'malformed, or come from an incompatible SDK version or a mocked/stubbed client',
    );
  });
});
