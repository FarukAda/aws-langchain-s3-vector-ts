import { CreateIndexCommand, DeleteIndexCommand, GetIndexCommand } from '@aws-sdk/client-s3vectors';
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
    await expect(lifecycle.deleteIndex(undefined, 'DeleteIndex')).resolves.toBeUndefined();
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
  });

  it('resolves when AWS reports the index already absent, because the requested state holds', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('NotFoundException'));
    await expect(lifecycle.deleteIndex(undefined, 'DeleteIndex')).resolves.toBeUndefined();
  });

  it('propagates any other failure with its class', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await lifecycle.deleteIndex(undefined, 'DeleteIndex').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('forgets that the index exists, so the next write re-checks', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    mock.on(DeleteIndexCommand).resolves({});

    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.deleteIndex(undefined, 'DeleteIndex');
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
    await lifecycle.deleteIndex(undefined, 'DeleteIndex').catch(() => undefined);
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
    const deleting = lifecycle.deleteIndex(undefined, 'DeleteIndex');

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
    const deleting = lifecycle.deleteIndex(undefined, 'DeleteIndex');
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
    const error = await lifecycle.deleteIndex(ac.signal, 'DeleteIndex').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(0);
  });

  it('threads the signal into the AWS request', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(DeleteIndexCommand).resolves({});
    const ac = new AbortController();
    await lifecycle.deleteIndex(ac.signal, 'DeleteIndex');
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
    const deleting = lifecycle.deleteIndex(undefined, 'DeleteIndex');
    release();
    await Promise.all([writing, deleting]);

    expect(mock.commandCalls(DeleteIndexCommand)).toHaveLength(1);
  });
});
