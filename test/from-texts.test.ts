import { PutVectorsCommand, type S3VectorsClient } from '@aws-sdk/client-s3vectors';
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

describe('AmazonS3Vectors.fromTexts metadatas', () => {
  async function storedMetadata(
    metadatas: Record<string, unknown>[] | Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    await AmazonS3Vectors.fromTexts(['a', 'b'], metadatas, createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
    });
    const put = mock.commandCalls(PutVectorsCommand)[0]!.args[0].input as {
      vectors: { metadata: Record<string, unknown> }[];
    };
    return put.vectors.map((v) => v.metadata);
  }

  it('pairs an array of matching length one to one', async () => {
    const stored = await storedMetadata([{ genre: 'a' }, { genre: 'b' }]);
    expect(stored[0]).toMatchObject({ genre: 'a' });
    expect(stored[1]).toMatchObject({ genre: 'b' });
  });

  it('broadcasts a single object to every text', async () => {
    const stored = await storedMetadata({ genre: 'shared' });
    expect(stored[0]).toMatchObject({ genre: 'shared' });
    expect(stored[1]).toMatchObject({ genre: 'shared' });
  });

  it('treats an omitted metadatas as an empty object per document', async () => {
    // Reachable from an untyped caller; it used to broadcast `undefined` into
    // `new Document({ metadata: undefined })`.
    const stored = await storedMetadata(undefined as unknown as Record<string, unknown>);
    // Only the page-content key, which the store writes itself.
    expect(Object.keys(stored[0]!)).toEqual(['_page_content']);
    expect(Object.keys(stored[1]!)).toEqual(['_page_content']);
  });
});

describe('AmazonS3Vectors.fromTexts/fromDocuments array validation', () => {
  it('fromTexts rejects a non-array texts argument with a coded VALIDATION error', async () => {
    const { client } = createMockClient();

    const error = await AmazonS3Vectors.fromTexts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      null as any,
      {},
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).message).toBe('texts must be an array.');
  });

  it('fromDocuments rejects a non-array docs argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const { client } = createMockClient();

    const error = await AmazonS3Vectors.fromDocuments(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      null as any,
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).message).toBe('documents must be an array.');
    // fromDocuments still attaches the constructed instance even for this
    // pre-validation failure, same as every other fromDocuments error.
    expect((error as S3VectorsError).context.instance).toBeInstanceOf(AmazonS3Vectors);
  });
});

describe('AmazonS3Vectors static factories — a config that is not an object', () => {
  // A store assembled at runtime from an empty environment hands the factory
  // `undefined`. The constructor refuses that by name; the factory used to
  // destructure it first, and "Cannot destructure property 'ids' of 'config'"
  // escaped as a raw TypeError — uncoded, from the one input the
  // constructor's own check exists for.
  it.each([undefined, null])(
    'fromDocuments refuses a %s config as the constructor does',
    async (config) => {
      const error = await AmazonS3Vectors.fromDocuments(
        [new Document({ pageContent: 'a' })],
        createMockEmbeddings(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
        config as any,
      ).catch((e: unknown) => e);

      expect(isS3VectorsError(error)).toBe(true);
      expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
      expect((error as S3VectorsError).context.operation).toBe('fromDocuments');
      // Nothing was constructed, so there is no store to hand back.
      expect((error as S3VectorsError).context.instance).toBeUndefined();
    },
  );

  it.each([undefined, null])('fromTexts refuses a %s config the same way', async (config) => {
    const error = await AmazonS3Vectors.fromTexts(
      ['a'],
      {},
      createMockEmbeddings(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      config as any,
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).context.operation).toBe('fromTexts');
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

  it('attaches the instance when a malformed document is refused', async () => {
    // A non-Document element is a realistic mistake for an untyped caller, or
    // for a TypeScript caller that casts past the type system. It used to
    // escape as a raw TypeError from `doc.id`, straight through
    // `fromDocuments`'s catch and out to the caller as `UNEXPECTED_ERROR`
    // carrying V8's own wording — which is the defect F-08 records: the
    // package's stated guarantee is that every failure is coded.
    //
    // It is now refused up front, by name and position. What this test still
    // pins is the part that was always right: the constructed store is
    // attached either way, so a caller can act on `context.writtenIds` against
    // the instance the ids were written to.
    const { client } = createMockClient();

    const error = await AmazonS3Vectors.fromDocuments(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed element
      [null] as any,
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).message).toContain('Document at index 0');
    const instance = (error as S3VectorsError).context.instance;
    expect(instance).toBeInstanceOf(AmazonS3Vectors);
  });
});

describe('AmazonS3Vectors.fromTexts names the element it refuses (R3)', () => {
  it('carries the position of a text that is not a string', async () => {
    const { client } = createMockClient();
    const error = await AmazonS3Vectors.fromTexts(
      ['a', 7 as unknown as string],
      {},
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).context.recordIndex).toBe(1);
  });

  it('carries the position of a metadatas entry that is not an object', async () => {
    const { client } = createMockClient();
    const badMetadata: Record<string, unknown> = 'oops' as unknown as Record<string, unknown>;
    const error = await AmazonS3Vectors.fromTexts(
      ['a', 'b'],
      [{}, badMetadata],
      createMockEmbeddings(),
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);
    expect((error as S3VectorsError).context.recordIndex).toBe(1);
  });
});

describe('AmazonS3Vectors static factories — the signal', () => {
  it.each([
    [
      'fromTexts',
      (client: S3VectorsClient, signal: AbortSignal) =>
        AmazonS3Vectors.fromTexts(['a'], {}, createMockEmbeddings(3), {
          ...BASE_CONFIG,
          client,
          signal,
        }),
    ],
    [
      'fromDocuments',
      (client: S3VectorsClient, signal: AbortSignal) =>
        AmazonS3Vectors.fromDocuments(
          [new Document({ pageContent: 'a' })],
          createMockEmbeddings(3),
          {
            ...BASE_CONFIG,
            client,
            signal,
          },
        ),
    ],
  ])(
    '%s rejects ABORTED on an already-fired signal, before embedding or writing',
    async (_label, start) => {
      const { client, mock } = createMockClient();
      mockExistingIndex(mock);
      const controller = new AbortController();
      controller.abort();

      const error = await start(client, controller.signal).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.ABORTED);
      expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(0);
    },
  );
});
