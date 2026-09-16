import {
  CreateIndexCommand,
  GetIndexCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

/**
 * What a failure says about itself (F-11, F-12, F-14).
 *
 * `error.context` is the difference between a report and something actionable,
 * and three claims about it were untrue. A listing that failed on a record
 * without data said nothing about how far it had got, even though the generator
 * that owns those counters was one frame away. `ResourceNotFoundException` was
 * read as proof an index was absent by one module and classified as an ordinary
 * request failure by another — a disagreement with no reachable trigger, since
 * S3 Vectors does not emit that name at all. And the field documentation
 * restricted `awsErrorName` and `retryable` to two codes when the code attaches
 * them to any AWS-shaped cause.
 */

function failureOf(call: () => Promise<unknown>): Promise<S3VectorsError | undefined> {
  return call().then(
    () => undefined,
    (error: unknown) => {
      if (isS3VectorsError(error)) return error;
      throw error;
    },
  );
}

function storeWith(): ReturnType<typeof createMockClient> & { store: AmazonS3Vectors } {
  const { client, mock } = createMockClient();
  const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
  return { client, mock, store };
}

describe('a listing failure says how far it got', () => {
  it('reports pagesScanned and yielded when a record arrives without data', async () => {
    const { mock, store } = storeWith();
    mock.on(ListVectorsCommand).resolves({
      vectors: [
        { key: 'a', data: { float32: [0.1, 0.2, 0.3] }, metadata: {} },
        { key: 'b', metadata: {} },
      ],
    });

    const error = await failureOf(async () => {
      for await (const _record of store.listVectors()) {
        // Drain until it throws; the first record yields, the second fails.
      }
    });

    expect(error?.code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect(error?.context.pagesScanned).toBe(1);
    expect(error?.context.yielded).toBe(1);
  });

  it('refuses an empty embedding, which is not a vector', async () => {
    // `data.float32 = []` satisfied a check for `data === undefined`, so a
    // record with no embedding at all was yielded as though it had one — and a
    // migration reading it would write dimensionless vectors into the target.
    const { mock, store } = storeWith();
    mock.on(ListVectorsCommand).resolves({
      vectors: [{ key: 'a', data: { float32: [] }, metadata: {} }],
    });

    const error = await failureOf(async () => {
      for await (const _record of store.listVectors()) {
        // The first record should fail rather than yield.
      }
    });

    expect(error?.code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect(error?.context.pagesScanned).toBe(1);
  });

  it('still reports the counters on an ordinary request failure', async () => {
    const { mock, store } = storeWith();
    mock
      .on(ListVectorsCommand)
      .rejectsOnce(Object.assign(new Error('nope'), { name: 'AccessDeniedException' }));

    const error = await failureOf(async () => {
      for await (const _doc of store.listDocuments()) {
        // Fails on the first page.
      }
    });

    expect(error?.code).toBe(S3VectorsErrorCode.ACCESS_DENIED);
    expect(error?.context.pagesScanned).toBe(0);
    expect(error?.context.yielded).toBe(0);
  });
});

describe('a name the service cannot send is not read as an answer', () => {
  it('does not treat ResourceNotFoundException as an absent index', async () => {
    // S3 Vectors declares thirteen exceptions and this is not one of them, so
    // the only way it arrives is from a proxy, a middleware or a mocked client —
    // none of which is evidence that the index is gone. Creating one on the
    // strength of it is the wrong recovery.
    const { mock, store } = storeWith();
    mock
      .on(GetIndexCommand)
      .rejects(Object.assign(new Error('nope'), { name: 'ResourceNotFoundException' }));
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    const error = await failureOf(async () =>
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })]),
    );

    expect(error?.code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });

  it('still treats the name the service does send as an absent index', async () => {
    const { mock, store } = storeWith();
    mock
      .on(GetIndexCommand)
      .rejects(Object.assign(new Error('nope'), { name: 'NotFoundException' }));
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});

    await expect(
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })]),
    ).resolves.toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });
});

describe('awsErrorName and retryable arrive on every AWS-shaped failure', () => {
  it('sets them on AWS_REJECTED, which the field docs used to exclude', async () => {
    const { mock, store } = storeWith();
    mock.on(QueryVectorsCommand).rejects(
      Object.assign(new Error('bad request'), {
        name: 'ValidationException',
        $metadata: { httpStatusCode: 400, requestId: 'req-1' },
      }),
    );

    const error = await failureOf(async () => store.similaritySearch('q', 1));

    expect(error?.code).toBe(S3VectorsErrorCode.AWS_REJECTED);
    expect(error?.context.awsErrorName).toBe('ValidationException');
    expect(error?.context.retryable).toBe(false);
    expect(error?.context.httpStatusCode).toBe(400);
    expect(error?.context.requestId).toBe('req-1');
  });

  it('sets them on THROTTLED, and marks it retryable', async () => {
    const { mock, store } = storeWith();
    mock.on(QueryVectorsCommand).rejects(
      Object.assign(new Error('slow down'), {
        name: 'TooManyRequestsException',
        $metadata: { httpStatusCode: 429 },
      }),
    );

    const error = await failureOf(async () => store.similaritySearch('q', 1));

    expect(error?.code).toBe(S3VectorsErrorCode.THROTTLED);
    expect(error?.context.awsErrorName).toBe('TooManyRequestsException');
    expect(error?.context.retryable).toBe(true);
  });

  it('leaves them unset for a failure that did not come from AWS', async () => {
    const { store } = storeWith();
    const error = await failureOf(async () => store.similaritySearch('q', 0));

    expect(error?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error?.context.awsErrorName).toBeUndefined();
    expect(error?.context.retryable).toBeUndefined();
  });
});
