import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  GetVectorBucketCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createIndexLifecycle } from '../../src/internal/index-lifecycle.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, indexFixture, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of `deleteIndex`, plus the serialisation that
 * closes the resurrection defect.
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

function lifecycleWith() {
  const { client, mock } = createMockClient();
  const lifecycle = createIndexLifecycle(
    { client, vectorBucketName: 'test-bucket', indexName: 'test-index' },
    { dataType: 'float32', distanceMetric: 'cosine', pageContentMetadataKey: null },
  );
  return { mock, lifecycle };
}

/** The order commands were issued in, as command class names. */
const issuedOrder = (mock: ReturnType<typeof lifecycleWith>['mock']): string[] =>
  mock.calls().map((call) => (call.args[0] as object).constructor.name);

describe('createIndexLifecycle().deleteIndex', () => {
  it('issues DeleteIndex and resolves', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).resolves({});
    await expect(lifecycle.deleteIndex(undefined, 'deleteIndex')).resolves.toBeUndefined();
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
  });

  it('resolves when AWS reports the index already absent, because the requested state holds', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    await expect(lifecycle.deleteIndex(undefined, 'deleteIndex')).resolves.toBeUndefined();
  });

  it('propagates any other failure with its class', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await lifecycle.deleteIndex(undefined, 'deleteIndex').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('forgets that the index exists, so the next write re-checks', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    mock.on(DeleteIndexCommand).resolves({});

    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.deleteIndex(undefined, 'deleteIndex');
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('does not forget existence when the delete fails', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    mock.on(DeleteIndexCommand).rejects(awsError('AccessDeniedException'));

    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.deleteIndex(undefined, 'deleteIndex').catch(() => undefined);
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('waits for an in-flight creation before deleting, so no index survives the delete', async () => {
    const { mock, lifecycle } = lifecycleWith();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      throw awsError('NotFoundException');
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    // A write opens the creation memo; its GetIndex is still in flight.
    const writing = lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    // A delete arrives while that creation is running.
    const deleting = lifecycle.deleteIndex(undefined, 'deleteIndex');

    release();
    await Promise.all([writing, deleting]);

    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
    // The delete must come last: otherwise the creation resurrects the index
    // after a completed deletion.
    expect(issuedOrder(mock)).toEqual([
      'GetIndexCommand',
      'CreateIndexCommand',
      'DeleteIndexCommand',
    ]);
  });

  it('leaves nothing believed to exist after racing a creation', async () => {
    const { mock, lifecycle } = lifecycleWith();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      throw awsError('NotFoundException');
    });
    mock.on(CreateIndexCommand).resolves({});
    mock.on(DeleteIndexCommand).resolves({});

    const writing = lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    const deleting = lifecycle.deleteIndex(undefined, 'deleteIndex');
    release();
    await Promise.all([writing, deleting]);

    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).resolves({});
    const ac = new AbortController();
    ac.abort();
    const error = await lifecycle.deleteIndex(ac.signal, 'deleteIndex').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(0);
  });

  it('threads the signal into the AWS request', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).resolves({});
    const ac = new AbortController();
    await lifecycle.deleteIndex(ac.signal, 'deleteIndex');
    const call = mock.commandCalls(DeleteIndexCommand)[0]!;
    expect(sendOptionsOf(call)?.abortSignal).toBe(ac.signal);
  });
  it('deletes anyway when the creation it waited for failed', async () => {
    const { mock, lifecycle } = lifecycleWith();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      throw awsError('TooManyRequestsException');
    });
    mock.on(DeleteIndexCommand).resolves({});

    const writing = lifecycle
      .ensureExists(3, undefined, 'ensureIndexExists')
      .catch(() => undefined);
    const deleting = lifecycle.deleteIndex(undefined, 'deleteIndex');
    release();
    await Promise.all([writing, deleting]);

    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
  });
});

/**
 * A 404 from `DeleteIndex` has two causes and one name.
 *
 * AWS answers a missing index and a missing *bucket* with the same
 * `NotFoundException` — "the specified resource can't be found"
 * (`API_S3VectorBuckets_DeleteIndex.html`) — and the exception carries nothing
 * but a message, which this package never branches on. Resolving on it was
 * right for the first cause and wrong for the second: a store pointed at a
 * mistyped bucket reported a production index destroyed, and the index lived on.
 * Every other operation already fails against a bucket that is not there;
 * `deleteIndex` alone swallowed it.
 *
 * So a 404 is followed by one question, `GetVectorBucket`, and only a definite
 * "no such bucket" changes the outcome.
 */
describe('deleteIndex — a missing bucket is not a missing index', () => {
  it('refuses when it is the bucket that does not exist', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(GetVectorBucketCommand).rejects(awsError('NotFoundException'));

    const error = await lifecycle.deleteIndex(undefined, 'deleteIndex').catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.NOT_FOUND);
    // The request that failed is still the delete; the check only explains it.
    expect((error as { context: Record<string, unknown> }).context).toMatchObject({
      operation: 'deleteIndex',
      awsCommand: 'DeleteIndex',
      vectorBucketName: 'test-bucket',
      indexName: 'test-index',
    });
    expect((error as Error).message).toContain('vector bucket "test-bucket" does not exist');
    expect(issuedOrder(mock)).toEqual(['DeleteIndexCommand', 'GetVectorBucketCommand']);
  });

  it('resolves when the bucket is there and only the index was gone', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(GetVectorBucketCommand).resolves({});

    await expect(lifecycle.deleteIndex(undefined, 'deleteIndex')).resolves.toBeUndefined();
    expect(mock.commandCalls(GetVectorBucketCommand)).toHaveLength(1);
    expect(mock.commandCalls(GetVectorBucketCommand)[0]!.args[0].input).toEqual({
      vectorBucketName: 'test-bucket',
    });
  });

  it('asks nothing about the bucket when the index was there to delete', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).resolves({});

    await lifecycle.deleteIndex(undefined, 'deleteIndex');

    expect(mock.commandCalls(GetVectorBucketCommand)).toHaveLength(0);
  });

  it.each([
    'AccessDeniedException',
    'TooManyRequestsException',
    'ServiceUnavailableException',
    'InternalServerException',
  ])(
    'still resolves when the question cannot be answered (%s): only a definite no changes the outcome',
    async (name) => {
      // The check is a courtesy on top of a documented idempotent success. A
      // caller granted `s3vectors:DeleteIndex` alone cannot ask it, and failing
      // their retry of an already-deleted index because a *diagnostic* was
      // denied would turn a working least-privilege setup into a failing one.
      const { mock, lifecycle } = lifecycleWith();
      mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
      mock.on(GetVectorBucketCommand).rejects(awsError(name));

      await expect(lifecycle.deleteIndex(undefined, 'deleteIndex')).resolves.toBeUndefined();
    },
  );

  it('is ABORTED when the signal cancels the question, naming the request it cancelled', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(GetVectorBucketCommand).rejects(awsError('AbortError'));

    const error = await lifecycle
      .deleteIndex(new AbortController().signal, 'deleteIndex')
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect((error as { context: Record<string, unknown> }).context).toMatchObject({
      operation: 'deleteIndex',
      awsCommand: 'GetVectorBucket',
    });
  });

  it('threads the signal into the question as it does into the delete', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(GetVectorBucketCommand).resolves({});
    const ac = new AbortController();

    await lifecycle.deleteIndex(ac.signal, 'deleteIndex');

    expect(sendOptionsOf(mock.commandCalls(GetVectorBucketCommand)[0]!)?.abortSignal).toBe(
      ac.signal,
    );
  });

  it('forgets that the index exists when it is the bucket that is gone', async () => {
    // Nothing of that name exists either way, so the next write has to look.
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    await lifecycle.ensureExists(3, undefined, 'addVectors');

    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(GetVectorBucketCommand).rejects(awsError('NotFoundException'));
    await lifecycle.deleteIndex(undefined, 'deleteIndex').catch(() => undefined);

    await lifecycle.ensureExists(3, undefined, 'addVectors');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });
});
