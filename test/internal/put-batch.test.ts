import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { putBatch, sendAws } from '../../src/internal/put-batch.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of the single-batch write (docs/CONTRACTS-DRAFT.md,
 * "Write path"). The ordering matters as much as the checks: everything this
 * refuses, it refuses before the index can be created, so a rejected batch
 * cannot leave a freshly created index behind.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function setup(overrides: Record<string, unknown> = {}) {
  const { client, mock } = createMockClient();
  mock.on(PutVectorsCommand).resolves({});
  const created: number[] = [];
  const absent: number[] = [];
  const run = (more: Record<string, unknown> = {}) =>
    putBatch({
      client,
      operation: 'addVectors',
      batchOffset: 0,
      vectors: [[1, 2, 3]],
      documents: [new Document({ pageContent: 'x' })],
      ids: ['a'],
      distanceMetric: 'cosine',
      pageContentMetadataKey: '_page_content',
      nonFilterableKeys: ['_page_content'],
      ensureIndex: async (dimension: number) => {
        created.push(dimension);
      },
      onIndexAbsent: () => {
        absent.push(1);
      },
      ...SCOPE,
      ...overrides,
      ...more,
    });
  return { mock, run, created, absent };
}

describe('putBatch', () => {
  it('writes the batch with its ids, vectors and metadata', async () => {
    const { mock, run } = setup();
    await run();
    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input as {
      vectors: { key: string; data: { float32: number[] }; metadata: Record<string, unknown> }[];
    };
    expect(input.vectors[0]!.key).toBe('a');
    expect(input.vectors[0]!.data.float32).toEqual([1, 2, 3]);
    expect(input.vectors[0]!.metadata['_page_content']).toBe('x');
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

  it('rejects metadata this index cannot store before creating anything', async () => {
    const { mock, run, created } = setup();
    const error = await run({
      documents: [new Document({ pageContent: 'x', metadata: { nested: { a: 1 } } })],
    }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The point of building metadata first: no index was created for a batch
    // that was never going to be writable.
    expect(created).toEqual([]);
    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
  });

  it('rejects a batch with no usable dimension', async () => {
    const { run } = setup();
    expect(codeOf(await run({ vectors: [[]], ids: ['a'] }).catch((e: unknown) => e))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it('rejects vectors that disagree on dimension inside one batch', async () => {
    const { run } = setup();
    const error = await run({
      vectors: [
        [1, 2, 3],
        [1, 2],
      ],
      documents: [new Document({ pageContent: 'x' }), new Document({ pageContent: 'y' })],
      ids: ['a', 'b'],
    }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect((error as Error).message).toBe(
      "Vector at index 1 in this batch has dimension 2, but this batch's first vector has " +
        'dimension 3. All vectors in the same batch must share the same dimension.',
    );
  });

  it('checks every vector for writability, not only the first', async () => {
    const { run } = setup();
    const error = await run({
      vectors: [
        [1, 2, 3],
        [1, 2, Number.NaN],
      ],
      documents: [new Document({ pageContent: 'x' }), new Document({ pageContent: 'y' })],
      ids: ['a', 'b'],
    }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
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
      vectors: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      documents: [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
      ids: ['a', 'b'],
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
    expect((error as { context: { operation: string } }).context.operation).toBe('PutVectors');
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
  it('returns the call result untouched', async () => {
    await expect(sendAws('PutVectors', SCOPE, async () => 'value')).resolves.toBe('value');
  });

  it.each([
    ['ValidationException', S3VectorsErrorCode.AWS_REJECTED],
    ['TooManyRequestsException', S3VectorsErrorCode.THROTTLED],
    ['AccessDeniedException', S3VectorsErrorCode.ACCESS_DENIED],
    ['SomethingUnknownException', S3VectorsErrorCode.AWS_REQUEST_FAILED],
  ])('maps %s to %s', async (name, expected) => {
    const error = await sendAws('PutVectors', SCOPE, () =>
      Promise.reject(Object.assign(new Error('x'), { name })),
    ).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(expected);
  });

  it('classifies an abort as ABORTED, because nothing failed', async () => {
    const error = await sendAws('PutVectors', SCOPE, () =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    ).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
  });
});
