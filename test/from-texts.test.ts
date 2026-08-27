import { PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
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
    const instance = (error as S3VectorsError).context.instance;
    expect(instance).toBeInstanceOf(AmazonS3Vectors);
    expect(instance!.vectorBucketName).toBe(BASE_CONFIG.vectorBucketName);
  });

  it('still attaches the instance via the defensive wrapAwsError fallback when addDocuments rejects with a non-S3VectorsError value', async () => {
    // Every real failure addDocuments can produce is already an
    // S3VectorsError (validation errors, aborts, and AWS failures are all
    // wrapped before they escape addDocuments), so _attachInstance's
    // wrapAwsError fallback has no current real-world trigger. Spying on
    // addDocuments itself is the only way to exercise that defensive
    // branch: it simulates addDocuments misbehaving (e.g. a future
    // regression that lets a raw error through) without changing what
    // addDocuments actually does today.
    const { client } = createMockClient();
    const addDocumentsSpy = jest
      .spyOn(AmazonS3Vectors.prototype, 'addDocuments')
      .mockRejectedValueOnce('raw string');

    const error = await AmazonS3Vectors.fromDocuments(
      [new Document({ pageContent: 'a' })],
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).message).toBe('fromDocuments failed: raw string');
    const instance = (error as S3VectorsError).context.instance;
    expect(instance).toBeInstanceOf(AmazonS3Vectors);
    addDocumentsSpy.mockRestore();
  });
});
