import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { putBatch, sendAws } from '../../src/internal/put-batch.js';
import { createWriteRateLimiter } from '../../src/internal/rate-limit.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of the single-batch write. It validates nothing —
 * every rule is applied to the whole input before the first batch is written —
 * so what is tested here is what it sends, when it creates the index, and what a
 * failure carries.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

const record = (key: string, text = 'x') => {
  const metadata = { _page_content: text };
  return { key, text, metadata, metadataBytes: Buffer.byteLength(JSON.stringify(metadata)) };
};

function setup() {
  const { client, mock } = createMockClient();
  mock.on(PutVectorsCommand).resolves({});
  const created: number[] = [];
  const absent: number[] = [];
  const run = (more: Record<string, unknown> = {}) =>
    putBatch({
      client,
      operation: 'addVectors',
      batchOffset: 0,
      records: [record('a')],
      vectors: [[1, 2, 3]],
      ensureIndex: async (dimension: number) => {
        created.push(dimension);
      },
      onIndexAbsent: () => {
        absent.push(1);
      },
      rateLimit: createWriteRateLimiter(false),
      ...SCOPE,
      ...more,
    });
  return { mock, run, created, absent };
}

type PutInput = {
  vectors: { key: string; data: { float32: number[] }; metadata: Record<string, unknown> }[];
};

describe('putBatch', () => {
  it('writes each record with its vector, key and metadata, in order', async () => {
    const { mock, run } = setup();
    await run({
      records: [record('a', 'one'), record('b', 'two')],
      vectors: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    });
    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input as PutInput;
    expect(input.vectors).toEqual([
      { key: 'a', data: { float32: [1, 2, 3] }, metadata: { _page_content: 'one' } },
      { key: 'b', data: { float32: [4, 5, 6] }, metadata: { _page_content: 'two' } },
    ]);
  });

  it('sends what it is given without validating it, because the whole input was validated first', async () => {
    const { mock, run } = setup();
    await run({ vectors: [[Number.NaN, 1, 2]] });
    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input as PutInput;
    expect(input.vectors[0]!.data.float32[0]).toBeNaN();
  });

  it('creates the index on batch 0, with the dimension taken from the first vector', async () => {
    const { run, created } = setup();
    await run();
    expect(created).toEqual([3]);
  });

  it('does not touch the index on a later batch', async () => {
    const { run, created } = setup();
    await run({ batchOffset: 1 });
    expect(created).toEqual([]);
  });

  it('does not touch the index when the store may not create one', async () => {
    const { run, created } = setup();
    await run({ ensureIndex: undefined });
    expect(created).toEqual([]);
  });

  it('threads the signal into the request', async () => {
    const { mock, run } = setup();
    const controller = new AbortController();
    await run({ signal: controller.signal });
    expect(sendOptionsOf(mock.commandCalls(PutVectorsCommand)[0]!)?.abortSignal).toBe(
      controller.signal,
    );
  });

  it('forgets the index exists when the write reports it gone', async () => {
    const { mock, run, absent } = setup();
    mock
      .on(PutVectorsCommand)
      .rejects(Object.assign(new Error('gone'), { name: 'NotFoundException' }));
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.NOT_FOUND);
    expect(absent).toHaveLength(1);
  });

  it('reports how many vectors the failed call carried, so a 503 is actionable', async () => {
    // AWS answers an oversized batch with the same 503 it uses for genuine
    // unavailability. The batch size is the only thing that lets a caller
    // choose between backing off and splitting.
    const { mock, run } = setup();
    mock.on(PutVectorsCommand).rejects(
      Object.assign(new Error('Currently unable to handle the request'), {
        name: 'ServiceUnavailableException',
      }),
    );
    const error = await run({
      records: [record('a'), record('b')],
      vectors: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    }).catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.SERVICE_UNAVAILABLE);
    expect((error as { context: { batchSize?: number } }).context.batchSize).toBe(2);
  });

  it('keeps the failure class and cause while adding the batch size', async () => {
    const { mock, run } = setup();
    const cause = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    mock.on(PutVectorsCommand).rejects(cause);
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect((error as Error).message).toContain('denied');
    expect((error as { cause?: unknown }).cause).toBeDefined();
    expect((error as { context: { batchSize?: number } }).context.batchSize).toBe(1);
    // Adding context must not make this decorator the apparent origin.
    expect((error as Error).stack).toContain('\n    at ');
    expect((error as { context: Record<string, unknown> }).context).toMatchObject({
      operation: 'addVectors',
      awsCommand: 'PutVectors',
    });
  });

  it('leaves the index believed to exist after an unrelated failure', async () => {
    const { mock, run, absent } = setup();
    mock
      .on(PutVectorsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const error = await run().catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(absent).toHaveLength(0);
  });
});

describe('sendAws', () => {
  const OPERATION = { operation: 'addVectors', ...SCOPE } as const;

  it('returns the call result untouched', async () => {
    await expect(sendAws('PutVectors', OPERATION, async () => 'value')).resolves.toBe('value');
  });

  it.each([
    ['ValidationException', S3VectorsErrorCode.AWS_REJECTED],
    ['TooManyRequestsException', S3VectorsErrorCode.THROTTLED],
    ['AccessDeniedException', S3VectorsErrorCode.ACCESS_DENIED],
    ['SomethingUnknownException', S3VectorsErrorCode.AWS_REQUEST_FAILED],
  ])('maps %s to %s', async (name, expected) => {
    const error = await sendAws('PutVectors', OPERATION, () =>
      Promise.reject(Object.assign(new Error('x'), { name })),
    ).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(expected);
  });

  it('names the public method as the operation and the command as the request', async () => {
    const error = await sendAws('DeleteVectors', { ...OPERATION, operation: 'delete' }, () =>
      Promise.reject(Object.assign(new Error('x'), { name: 'AccessDeniedException' })),
    ).catch((e: unknown) => e);
    expect((error as { context: Record<string, unknown> }).context).toEqual({
      operation: 'delete',
      awsCommand: 'DeleteVectors',
      ...SCOPE,
      awsErrorName: 'AccessDeniedException',
      retryable: false,
    });
  });

  it('classifies an abort as ABORTED, because nothing failed', async () => {
    const error = await sendAws('PutVectors', OPERATION, () =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    ).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
  });
});
