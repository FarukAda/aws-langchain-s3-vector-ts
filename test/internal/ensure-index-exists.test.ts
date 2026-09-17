import { CreateIndexCommand, GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createIndexLifecycle } from '../../src/internal/index-lifecycle.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient, indexFixture, sendOptionsOf } from '../helpers.js';

/**
 * One test per domain cell of `ensureExists`.
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

const notFound = (): void => undefined;

describe('createIndexLifecycle().ensureExists', () => {
  it('resolves without creating anything when the index is already there', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });

  it('creates the index with the given dimension when it is absent', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(CreateIndexCommand).resolves({});
    await lifecycle.ensureExists(7, undefined, 'ensureIndexExists');
    const call = mock.commandCalls(CreateIndexCommand)[0]!;
    expect(call.args[0].input).toMatchObject({
      vectorBucketName: 'test-bucket',
      indexName: 'test-index',
      dimension: 7,
      distanceMetric: 'cosine',
      dataType: 'float32',
    });
  });

  it('treats a ConflictException from CreateIndex as success, because another process created it first', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(CreateIndexCommand).rejects(awsError('ConflictException'));
    await expect(
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
    ).resolves.toBeUndefined();
  });

  it('propagates a non-conflict creation failure with its class', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(CreateIndexCommand).rejects(awsError('AccessDeniedException'));
    const error = await lifecycle
      .ensureExists(3, undefined, 'ensureIndexExists')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });

  it('issues no further request once existence is known', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
  });

  it('does not remember existence after a failure, so the next call retries', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('TooManyRequestsException'));
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists').catch(notFound);
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists').catch(notFound);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('shares one GetIndex and one CreateIndex across concurrent callers', async () => {
    const { mock, lifecycle } = lifecycleWith();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      throw awsError('NotFoundException');
    });
    mock.on(CreateIndexCommand).resolves({});

    const all = Promise.all([
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
    ]);
    release();
    await all;

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });
    const ac = new AbortController();
    ac.abort();
    const error = await lifecycle
      .ensureExists(3, ac.signal, 'ensureIndexExists')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ABORTED);
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });

  it("one caller's abort does not cancel the work a sibling is waiting on", async () => {
    const { mock, lifecycle } = lifecycleWith();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.on(GetIndexCommand).callsFake(async () => {
      await gate;
      return { index: indexFixture({ metadataConfiguration: undefined }) };
    });

    const ac = new AbortController();
    const aborted = lifecycle
      .ensureExists(3, ac.signal, 'ensureIndexExists')
      .catch((e: unknown) => codeOf(e));
    const sibling = lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    ac.abort();
    expect(await aborted).toBe(S3VectorsErrorCode.ABORTED);

    release();
    await expect(sibling).resolves.toBeUndefined();
  });

  it('never ties the shared CreateIndex call to any one caller signal', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(CreateIndexCommand).resolves({});
    const ac = new AbortController();
    await lifecycle.ensureExists(3, ac.signal, 'ensureIndexExists');
    const call = mock.commandCalls(CreateIndexCommand)[0]!;
    expect(sendOptionsOf(call)?.abortSignal).toBeUndefined();
  });
  it('reports the shared failure, not an abort, when a caller holds an unfired signal', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock.on(GetIndexCommand).rejects(awsError('TooManyRequestsException'));
    const ac = new AbortController();
    const error = await lifecycle
      .ensureExists(3, ac.signal, 'ensureIndexExists')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.THROTTLED);
  });
  it('re-checks after markAbsent, so a write that met NotFoundException recovers', async () => {
    const { mock, lifecycle } = lifecycleWith();
    mock
      .on(GetIndexCommand)
      .resolves({ index: indexFixture({ metadataConfiguration: undefined }) });

    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);

    lifecycle.markAbsent();
    await lifecycle.ensureExists(3, undefined, 'ensureIndexExists');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });
});

describe('createIndexLifecycle().ensureExists — losing the creation race', () => {
  /** A lifecycle whose store expects one non-filterable key. */
  function lifecycleExpecting(keys: string[]) {
    const { client, mock } = createMockClient();
    const lifecycle = createIndexLifecycle(
      { client, vectorBucketName: 'test-bucket', indexName: 'test-index' },
      {
        dataType: 'float32',
        distanceMetric: 'cosine',
        pageContentMetadataKey: null,
        nonFilterableMetadataKeys: keys,
      },
    );
    return { mock, lifecycle };
  }

  it('reads the winner’s configuration and refuses one that disagrees', async () => {
    // The winner's settings are the index's: creation fixes them, and this
    // store would otherwise budget metadata against a set the index does not
    // have, for its whole life. Live, the winner's configuration is readable
    // immediately after the conflict (docs/evidence/index-create-race.md).
    const { mock, lifecycle } = lifecycleExpecting(['mine']);
    mock
      .on(GetIndexCommand)
      .rejectsOnce(awsError('NotFoundException'))
      .resolves({
        index: indexFixture({ metadataConfiguration: { nonFilterableMetadataKeys: ['theirs'] } }),
      });
    mock.on(CreateIndexCommand).rejects(awsError('ConflictException'));

    const error = await lifecycle
      .ensureExists(3, undefined, 'ensureIndexExists')
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect((error as Error).message).toContain('theirs');
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('accepts the winner’s configuration when it is the one this store wanted', async () => {
    const { mock, lifecycle } = lifecycleExpecting(['mine']);
    mock
      .on(GetIndexCommand)
      .rejectsOnce(awsError('NotFoundException'))
      .resolves({
        index: indexFixture({ metadataConfiguration: { nonFilterableMetadataKeys: ['mine'] } }),
      });
    mock.on(CreateIndexCommand).rejects(awsError('ConflictException'));

    await expect(
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
    ).resolves.toBeUndefined();
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(2);
  });

  it('asks nothing more when the index vanished again before it could be read', async () => {
    const { mock, lifecycle } = lifecycleExpecting(['mine']);
    mock.on(GetIndexCommand).rejects(awsError('NotFoundException'));
    mock.on(CreateIndexCommand).rejects(awsError('ConflictException'));

    await expect(
      lifecycle.ensureExists(3, undefined, 'ensureIndexExists'),
    ).resolves.toBeUndefined();
  });
});
