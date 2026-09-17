import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import type { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createTestStore, mockExistingIndex } from './helpers.js';

describe('AmazonS3Vectors.addDocuments — id count', () => {
  it('names documents, not vectors, when the id count disagrees', async () => {
    const { store } = createTestStore();
    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['a', 'b'] })
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe('Number of IDs (2) must match number of documents (1)');
    expect((error as { context: { operation: string } }).context.operation).toBe('addDocuments');
  });

  it('names addDocuments when the documents argument is not an array', async () => {
    const { store } = createTestStore();
    const error = await store.addDocuments(null as unknown as Document[]).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('documents must be an array.');
    expect((error as { context: { operation: string } }).context.operation).toBe('addDocuments');
  });

  it('names addDocuments on an id-shape rejection too, not the helper that resolves ids', async () => {
    const { store } = createTestStore();
    const error = await store
      .addDocuments([new Document({ pageContent: 'x' }), new Document({ pageContent: 'y' })], {
        ids: ['same', 'same'],
      })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as { context: { operation: string } }).context.operation).toBe('addDocuments');
  });
});

describe('AmazonS3Vectors.addDocuments', () => {
  it('embeds documents and calls addVectors', async () => {
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);

    const docs = [new Document({ pageContent: 'hello' })];
    const ids = await store.addDocuments(docs, { ids: ['doc-1'] });

    expect(ids).toEqual(['doc-1']);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(['hello']);
  });
});

describe('AmazonS3Vectors.addDocuments input validation', () => {
  it('returns empty array for empty input', async () => {
    const { store } = createTestStore();

    const ids = await store.addDocuments([]);
    expect(ids).toEqual([]);
  });

  it('rejects a non-array documents argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const { store } = createTestStore();

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .addDocuments(null as any)
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('documents must be an array.');
  });

  it('throws when ids count mismatches documents count', async () => {
    const { store } = createTestStore();

    await expect(
      store.addDocuments([new Document({ pageContent: 'a' }), new Document({ pageContent: 'b' })], {
        ids: ['only-one'],
      }),
    ).rejects.toThrow('Number of IDs (1) must match number of documents (2)');
  });

  it('throws for mismatched ids even when documents is empty, instead of silently returning []', async () => {
    const { store, mock } = createTestStore();

    await expect(store.addDocuments([], { ids: ['stale-id-1', 'stale-id-2'] })).rejects.toThrow(
      'Number of IDs (2) must match number of documents (0)',
    );
    expect(mock.commandCalls(GetIndexCommand)).toHaveLength(0);
  });
});

describe('AmazonS3Vectors.addDocuments per-batch embedding', () => {
  it('embeds documents per batch instead of all at once', async () => {
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);

    const docs = [
      new Document({ pageContent: 'a' }),
      new Document({ pageContent: 'b' }),
      new Document({ pageContent: 'c' }),
    ];

    await store.addDocuments(docs, { batchSize: 2 });

    // embedDocuments should be called twice: once for ["a","b"], once for ["c"]
    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(embeddings.embedDocuments).toHaveBeenNthCalledWith(2, ['c']);
  });
});

describe('AmazonS3Vectors.addDocuments without embeddings', () => {
  it('throws a coded S3VectorsError instead of a plain Error', async () => {
    const { client } = createMockClient();
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });

    try {
      await store.addDocuments([new Document({ pageContent: 'x' })]);
      throw new Error('should have thrown');
    } catch (error: unknown) {
      expect(isS3VectorsError(error)).toBe(true);
      expect((error as { code: S3VectorsErrorCode }).code).toBe(
        S3VectorsErrorCode.EMBEDDINGS_MISSING,
      );
      // Names the write, and the option that fixes it — `queryEmbeddings`
      // would not, which is the distinction worth making.
      expect((error as { context: { operation: string } }).context.operation).toBe('addDocuments');
      expect((error as Error).message).toBe(
        'No embedding model configured for indexing. Provide `embeddings` in the config.',
      );
    }
  });
});

describe('AmazonS3Vectors.addDocuments ids-option validation', () => {
  it('rejects a non-array ids option before embedding or writing', async () => {
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .addDocuments([new Document({ pageContent: 'a' })], { ids: 'x' as any })
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('ids must be an array.');
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
  });
});

describe('AmazonS3Vectors.addDocuments — nothing is spent on an input that cannot be written (R1)', () => {
  it('refuses a document S3 Vectors cannot store before embedding or requesting anything', async () => {
    // The report's scenario, scaled down: batches of two, the bad record in the third.
    const { store, mock, embeddings } = createTestStore();
    mockExistingIndex(mock);
    const docs = Array.from(
      { length: 6 },
      (_, i) =>
        new Document({
          pageContent: `ticket ${i}`,
          metadata: { category: i === 4 ? null : 'billing' },
        }),
    );
    const error = (await store
      .addDocuments(docs, { ids: docs.map((_, i) => `ticket-${i}`), batchSize: 2 })
      .catch((e: unknown) => e)) as S3VectorsError;

    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toMatch(
      /^Document at index 4 \(id "ticket-4"\): Metadata key 'category'/,
    );
    expect(error.context).toMatchObject({ recordIndex: 4, recordId: 'ticket-4' });
    expect(error.context.writtenIds).toBeUndefined();
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
    expect(mock.calls()).toHaveLength(0);
  });

  it('names an embedded vector S3 Vectors cannot store by its position in the whole input', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts) =>
        texts.map((text) => (text === 'd3' ? [Number.NaN, 1, 2] : [1, 2, 3])),
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = ['d0', 'd1', 'd2', 'd3'].map((pageContent) => new Document({ pageContent }));
    const error = (await store
      .addDocuments(docs, { ids: ['a', 'b', 'c', 'd'], batchSize: 2 })
      .catch((e: unknown) => e)) as S3VectorsError;

    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain(
      'Vector at index 3 (id "d") has a component at position 0 that is not a finite number',
    );
    // A model's output cannot be checked before it exists: the first batch had
    // already landed, and the error says so.
    expect(error.context).toMatchObject({
      recordIndex: 3,
      recordId: 'd',
      writtenIds: ['a', 'b'],
      attemptedIds: ['a', 'b', 'c', 'd'],
    });
  });
});

describe('AmazonS3Vectors.addDocuments — an embeddings model returning something unusable (N4)', () => {
  const storeWith = (embedDocuments: () => Promise<unknown>) => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);
    const embeddings = {
      embedDocuments,
      embedQuery: async () => [1, 2, 3],
    } as unknown as EmbeddingsInterface;
    return new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
  };

  it.each([
    ['null', async () => null, 'Embeddings model returned null instead of an array of vectors.'],
    [
      'a string',
      async () => 'vectors',
      'Embeddings model returned a string instead of an array of vectors.',
    ],
  ])(
    'refuses %s in place of the vector list as VALIDATION',
    async (_label, embedDocuments, message) => {
      const error = (await storeWith(embedDocuments)
        .addDocuments([new Document({ pageContent: 'x' })])
        .catch((e: unknown) => e)) as S3VectorsError;
      expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
      expect(error.message).toBe(message);
    },
  );

  it('refuses a list holding null as VALIDATION, naming the document', async () => {
    const error = (await storeWith(async () => [null])
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['only'] })
      .catch((e: unknown) => e)) as S3VectorsError;
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain(
      'Vector at index 0 (id "only") is not an array (received null)',
    );
  });
});
