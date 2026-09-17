import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { MAX_REQUEST_BODY_BYTES } from '../src/internal/request-size.js';
import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient } from './helpers.js';

/**
 * AWS refuses a `PutVectors` body over 20 MiB, exactly and inclusively
 * (`docs/evidence/request-payload-limit.md`). A batch that would exceed it is
 * split into several requests rather than sent and refused — the refusal would
 * arrive after the batch had been embedded, and, for a batch after the first,
 * with earlier batches already written.
 */
const DIM = 4096;
/** 4,096 dimensions plus 39 KB of page content is ~127 KB per record on the wire. */
const CONTENT = 'x'.repeat(39000);

/** The body the SDK will send for a recorded `PutVectors` call. */
function bodyBytes(input: unknown): number {
  const { vectors, vectorBucketName, indexName } = input as {
    vectors: unknown;
    vectorBucketName: string;
    indexName: string;
  };
  return Buffer.byteLength(JSON.stringify({ vectors, vectorBucketName, indexName }), 'utf8');
}

function vector(seed: number): number[] {
  const data = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) data[i] = Math.sin(i * 0.37 + seed) * 0.05 + 0.001;
  return Array.from(data);
}

function docs(count: number): Document[] {
  return Array.from({ length: count }, () => new Document({ pageContent: CONTENT }));
}

const bigEmbeddings: EmbeddingsInterface = {
  embedDocuments: async (texts: string[]) => texts.map((_, i) => vector(i)),
  embedQuery: async () => vector(0),
};

describe('a write larger than the 20 MiB request limit', () => {
  let client: ReturnType<typeof createMockClient>['client'];
  let mock: ReturnType<typeof createMockClient>['mock'];

  beforeEach(() => {
    ({ client, mock } = createMockClient());
    mock.on(GetIndexCommand).rejects(
      Object.assign(new Error('missing'), {
        name: 'NotFoundException',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});
  });

  it('splits addVectors into requests AWS accepts, and still returns every id', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const count = 200; // the default batch size

    const ids = await store.addVectors(
      Array.from({ length: count }, (_, i) => vector(i)),
      docs(count),
    );

    const calls = mock.commandCalls(PutVectorsCommand);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(bodyBytes(call.args[0].input)).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);
    }
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
    // Every record is written exactly once, in input order.
    const written = calls.flatMap((call) => (call.args[0].input.vectors ?? []).map((v) => v.key));
    expect(written).toEqual(ids);
  });

  it('splits an embedded batch too, where the size is only known after embedding', async () => {
    const store = new AmazonS3Vectors(bigEmbeddings, { ...BASE_CONFIG, client });
    const count = 200;

    const ids = await store.addDocuments(docs(count));

    const calls = mock.commandCalls(PutVectorsCommand);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(bodyBytes(call.args[0].input)).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);
    }
    expect(ids).toHaveLength(count);
    const written = calls.flatMap((call) => (call.args[0].input.vectors ?? []).map((v) => v.key));
    expect(written).toEqual(ids);
  });

  it('leaves a batch that already fits as one request', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    await store.addVectors([vector(0), vector(1)], docs(2));

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
  });

  it('checks the index once, however many requests the first batch becomes', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const count = 200;

    await store.addVectors(
      Array.from({ length: count }, (_, i) => vector(i)),
      docs(count),
    );

    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(1);
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('reports the ids of the requests that did land when a later one fails', async () => {
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    const count = 200;
    let seen = 0;
    mock.on(PutVectorsCommand).callsFake(() => {
      seen++;
      if (seen > 1) {
        throw Object.assign(new Error('Request body exceeds max allowed size'), {
          name: 'ValidationException',
          $metadata: { httpStatusCode: 400 },
        });
      }
      return {};
    });

    const error: S3VectorsError = await store
      .addVectors(
        Array.from({ length: count }, (_, i) => vector(i)),
        docs(count),
      )
      .then(
        () => {
          throw new Error('expected the write to fail');
        },
        (e: unknown) => e as S3VectorsError,
      );

    expect(error.code).toBe(S3VectorsErrorCode.AWS_REJECTED);
    const first = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors ?? [];
    expect(error.context.writtenIds).toEqual(first.map((v) => v.key));
    expect(error.context.attemptedIds).toHaveLength(count);
  });
});
