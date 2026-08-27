import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import {
  BASE_CONFIG,
  createMockClient,
  createMockEmbeddings,
  mockExistingIndex,
} from './helpers.js';

describe('AmazonS3Vectors.fromTexts', () => {
  it('creates instance, embeds, and stores texts', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mockExistingIndex(mock);

    const store = await AmazonS3Vectors.fromTexts(
      ['hello', 'world'],
      [{ genre: 'a' }, { genre: 'b' }],
      embeddings,
      { ...BASE_CONFIG, client },
    );

    expect(store).toBeInstanceOf(AmazonS3Vectors);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello', 'world']);
  });
});

describe('AmazonS3Vectors.fromTexts metadata handling', () => {
  it('applies a single metadata object to every text', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mockExistingIndex(mock);

    await AmazonS3Vectors.fromTexts(['a', 'b'], { shared: true }, embeddings, {
      ...BASE_CONFIG,
      client,
    });

    const input = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input;
    expect(input.vectors?.[0]?.metadata).toMatchObject({ shared: true });
    expect(input.vectors?.[1]?.metadata).toMatchObject({ shared: true });
  });

  it('throws when the metadata array is shorter than the texts array', async () => {
    const { client } = createMockClient();
    const embeddings = createMockEmbeddings();

    await expect(
      AmazonS3Vectors.fromTexts(['a', 'b'], [{ only: 'first' }], embeddings, {
        ...BASE_CONFIG,
        client,
      }),
    ).rejects.toThrow('Number of metadatas (1) must match number of texts (2)');
  });
});

describe('AmazonS3Vectors.fromDocuments batchSize forwarding', () => {
  it('forwards batchSize to the underlying addDocuments call', async () => {
    const { client, mock } = createMockClient();
    const embeddings = createMockEmbeddings();

    mockExistingIndex(mock);

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    await AmazonS3Vectors.fromDocuments(docs, embeddings, { ...BASE_CONFIG, client, batchSize: 2 });

    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(2, ['c']);
  });
});

describe('fromDocuments — partial-write failure', () => {
  it('attaches the constructed instance to the thrown error so writtenIds can be acted on', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const failure = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    mock.on(PutVectorsCommand).rejectsOnce(failure).resolves({});

    const error = await AmazonS3Vectors.fromDocuments(
      [new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })],
      createMockEmbeddings(),
      { ...BASE_CONFIG, client, batchSize: 1, ids: ['id-1', 'id-2'] },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    // A real AWS failure must still be AWS_REQUEST_FAILED, not
    // UNEXPECTED_ERROR — this is the AWS-originated counterpart to the
    // non-AWS UNEXPECTED_ERROR case covered below.
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    const instance = (error as S3VectorsError).context.instance;
    expect(instance).toBeInstanceOf(AmazonS3Vectors);
    expect(instance!.vectorBucketName).toBe(BASE_CONFIG.vectorBucketName);
  });

  it('still attaches the instance via the _normalizeToS3VectorsError fallback when addDocuments throws before it wraps anything itself', async () => {
    // addDocuments's own error-wrapping (_checkAborted, the try/catch around
    // embedBatch+putBatch, _attachPartialIds) only starts a few lines in —
    // `documents.map(...)` on the very first line runs before any of it, so
    // a non-array `docs` (a realistic mistake for an untyped JS caller, or a
    // TS caller that casts past the type system) throws a raw, un-wrapped
    // TypeError straight into fromDocuments's catch. This is a genuine,
    // organic trigger for _attachInstance's UNEXPECTED_ERROR fallback (via
    // _normalizeToS3VectorsError) — not just a defensive branch for a
    // hypothetical future regression.
    const { client } = createMockClient();

    const error = await AmazonS3Vectors.fromDocuments(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input to trigger addDocuments' pre-validation throw
      null as any,
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    // UNEXPECTED_ERROR, not AWS_REQUEST_FAILED: nothing about AWS failed
    // here — documents.map(...) threw before any AWS call was ever made.
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    // Substring, not an exact match: the tail is V8's own TypeError wording
    // for the failed `documents.map(...)` call, not this library's text.
    expect((error as S3VectorsError).message).toContain('fromDocuments failed:');
    // The real cause must still be attached (not just a generic message
    // prefix with the original TypeError silently dropped).
    expect((error as S3VectorsError).cause).toBeInstanceOf(TypeError);
    const instance = (error as S3VectorsError).context.instance;
    expect(instance).toBeInstanceOf(AmazonS3Vectors);
  });
});
