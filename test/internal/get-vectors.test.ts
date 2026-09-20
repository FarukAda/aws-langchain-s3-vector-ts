import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { fetchVectorsByIds } from '../../src/internal/get-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of `fetchVectorsByIds`. A Map keyed by id, because
 * GetVectors does not return results in request order
 * (docs/evidence/get-vectors-absent-keys.md).
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function setup() {
  const { client, mock } = createMockClient();
  const run = (ids: readonly string[], overrides: Record<string, unknown> = {}) =>
    fetchVectorsByIds({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'getByIds',
      ids,
      returnData: false,
      returnMetadata: true,
      ...overrides,
    });
  return { mock, run };
}

/** Echo back whatever keys were asked for, minus any named absent. */
const echo =
  (absent: string[] = []) =>
  (input: { keys: string[] }) => ({
    vectors: input.keys
      .filter((k) => !absent.includes(k))
      .map((k) => ({ key: k, metadata: { id: k } })),
  });

describe('fetchVectorsByIds', () => {
  it('returns an empty map and issues no request for no keys', async () => {
    const { mock, run } = setup();
    expect((await run([])).size).toBe(0);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });

  it('returns one entry per key found, keyed by id', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo());
    const found = await run(['a', 'b']);
    expect([...found.keys()].sort()).toEqual(['a', 'b']);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(1);
  });

  it('omits keys the service does not return, which is how absence is reported', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo(['missing']));
    const found = await run(['a', 'missing', 'b']);
    expect(found.has('missing')).toBe(false);
    expect(found.size).toBe(2);
  });

  it('is unaffected by the service returning results out of request order', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => ({
      vectors: [...input.keys].reverse().map((k) => ({ key: k, metadata: {} })),
    }));
    const found = await run(['a', 'b', 'c']);
    expect([...found.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits into batches of at most 100, the documented GetVectors maximum', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo());
    const keys = Array.from({ length: 250 }, (_, i) => `k${i}`);
    const found = await run(keys);
    expect(found.size).toBe(250);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(3);
    for (const call of mock.commandCalls(GetVectorsCommand)) {
      expect((call.args[0].input as { keys: string[] }).keys.length).toBeLessThanOrEqual(100);
    }
  });

  it('collapses a duplicate key into one entry', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo());
    const found = await run(['a', 'a', 'b']);
    expect(found.size).toBe(2);
  });

  it('forwards returnData when the caller needs the vectors themselves', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => ({
      vectors: input.keys.map((k) => ({ key: k, data: { float32: [1, 2, 3] } })),
    }));
    const found = await run(['a'], { returnData: true, returnMetadata: false });
    expect(found.get('a')?.data?.float32).toEqual([1, 2, 3]);
    expect(mock.commandCalls(GetVectorsCommand)[0]!.args[0].input).toMatchObject({
      returnData: true,
    });
  });

  it('reports what was retrieved when one batch fails alongside successful siblings', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => {
      if (input.keys.includes('k100')) throw awsError('AccessDeniedException');
      return echo()(input);
    });
    const keys = Array.from({ length: 150 }, (_, i) => `k${i}`);
    const error = await run(keys).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    // The sibling batch succeeded and must not be lost from the report.
    expect((error as { context: { foundIds?: string[] } }).context.foundIds).toHaveLength(100);
    // And the message points at the field that holds them.
    expect((error as Error).message).toContain(
      'vector(s) were already retrieved before this failure — see error.context.foundIds.',
    );
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo());
    const ac = new AbortController();
    ac.abort();
    const error = await run(['a'], { signal: ac.signal }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });

  it('threads the signal into every request', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).callsFake(echo());
    const ac = new AbortController();
    await run(['a'], { signal: ac.signal });
    expect(sendOptionsOf(mock.commandCalls(GetVectorsCommand)[0]!)?.abortSignal).toBe(ac.signal);
  });

  it('treats a response with no vectors field as nothing found', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).resolves({});
    expect((await run(['a'])).size).toBe(0);
  });

  it('rejects a nullish response from a non-conforming client', async () => {
    const { mock, run } = setup();
    mock.on(GetVectorsCommand).resolves(undefined as never);
    const error = await run(['a']).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect((error as Error).message).toContain(
      'malformed, or come from an incompatible SDK version or a mocked/stubbed client',
    );
  });
});
