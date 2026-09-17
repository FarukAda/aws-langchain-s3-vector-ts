import {
  GetVectorsCommand,
  ListVectorsCommand,
  QueryVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createTestStore, mockExistingIndex } from './helpers.js';

/**
 * Several paths rebuild an error to attach context (partial ids, the
 * constructed instance, pagination state). A rebuilt `Error` gets a fresh
 * stack pointing at the helper that rebuilt it, which hides the code that
 * actually failed — the one thing a stack exists to show. The rebuilt error
 * must therefore carry the original throw site's frames.
 */
describe('AmazonS3Vectors — a rebuilt error keeps the original throw site', () => {
  it('addDocuments partial-failure keeps the frame that raised the abort', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const controller = new AbortController();
    let embedCalls = 0;
    const embeddings: EmbeddingsInterface = {
      embedDocuments: async (texts: string[]) => {
        embedCalls += 1;
        if (embedCalls === 2) controller.abort();
        return texts.map(() => [1, 2, 3]);
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });
    const docs = Array.from({ length: 12 }, (_, i) => new Document({ pageContent: `d-${i}` }));

    const error = await store
      .addDocuments(docs, { batchSize: 1, signal: controller.signal })
      .catch((e: unknown) => e);

    const stack = String((error as Error).stack);
    // The abort is raised by `checkAborted`; `attachPartialIds` only decorates
    // it. The decorator must not become the apparent origin.
    expect(stack).toContain('checkAborted');
    expect(stack.split('\n')[1]).not.toContain('attachPartialIds');
    // The decorated message is still the one reported.
    expect(stack).toContain('already durably written');
  });

  it('fromDocuments keeps the original throw site when attaching the instance', async () => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const embeddings: EmbeddingsInterface = {
      embedDocuments: async () => {
        throw new Error('embedding provider exploded');
      },
      embedQuery: async () => [1, 2, 3],
    };

    const error = await AmazonS3Vectors.fromDocuments(
      [new Document({ pageContent: 'x' })],
      embeddings,
      { ...BASE_CONFIG, client },
    ).catch((e: unknown) => e);

    const stack = String((error as Error).stack);
    expect(stack).toContain('embedding provider exploded');
    expect(stack.split('\n')[1]).not.toContain('_attachInstance');
  });

  it('a mid-pagination failure keeps the frame that raised it', async () => {
    const { store, mock } = createTestStore();

    mock
      .on(QueryVectorsCommand)
      .resolvesOnce({
        distanceMetric: 'cosine',
        vectors: [{ key: 'k', metadata: { _page_content: 'x' }, distance: 0.1 }],
        nextToken: 'page-2',
      })
      .rejects(new Error('token expired'));

    const error = await store
      .similaritySearchVectorWithScore([1, 2, 3], 50)
      .catch((e: unknown) => e);

    const stack = String((error as Error).stack);
    expect(stack).toContain('re-issue the original query');
    expect(stack.split('\n')[1]).not.toContain('_explainPaginationFailure');
  });

  it('a partial GetVectors failure keeps the frames of the wrapped request failure', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(GetVectorsCommand, { keys: ['found'] })
      .resolves({ vectors: [{ key: 'found', metadata: { _page_content: 'x' } }] });
    mock.on(GetVectorsCommand, { keys: ['failing'] }).rejects(new Error('socket closed'));

    const error = await store
      .getByIds(['found', 'failing'], { batchSize: 1 })
      .catch((e: unknown) => e);

    const stack = String((error as Error).stack);
    // `withFoundIds` adds the retrieved ids to the failure `wrapAwsError` built;
    // the stack must still be that failure's, under the decorated header.
    expect(stack).toContain('already retrieved');
    // By file, not function name: coverage instrumentation shifts the names.
    expect(stack).toContain('wrap-error.ts');
    expect(stack).not.toContain('decorate.ts');
  });

  it('a listing failure keeps the frames of the wrapped request failure', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(ListVectorsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    const error = await (async () => {
      for await (const _doc of store.listDocuments()) break;
    })().catch((e: unknown) => e);

    const stack = String((error as Error).stack);
    // `explainListing` adds the IAM hint and the progress counters to the
    // failure `wrapAwsError` built; the stack must still be that failure's.
    expect(stack).toContain('s3vectors:GetVectors');
    // By file, not function name: coverage instrumentation shifts the names.
    expect(stack).toContain('wrap-error.ts');
    expect(stack).not.toContain('decorate.ts');
  });

  // The splice recognises V8's frame format rather than assuming it. An
  // error carrying no stack at all, or one in some other shape (a
  // cross-realm error, a rehydrated/serialized one, a non-V8 engine), must
  // still decorate cleanly instead of producing a corrupted stack.
  it.each([
    ['no stack at all', undefined],
    ['a stack with no recognisable frames', 'S3VectorsError: boom (no frames)'],
  ])('falls back safely when the original error has %s', async (_label, stack) => {
    const { client, mock } = createMockClient();
    mockExistingIndex(mock);

    const embeddings: EmbeddingsInterface = {
      embedDocuments: async () => {
        const err = new S3VectorsError('boom', S3VectorsErrorCode.VALIDATION, {
          operation: 'addDocuments',
        });
        (err as { stack: string | undefined }).stack = stack;
        throw err;
      },
      embedQuery: async () => [1, 2, 3],
    };
    const store = new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, client });

    const error = await store
      .addDocuments([new Document({ pageContent: 'x' })], { ids: ['id-0'] })
      .catch((e: unknown) => e);

    // Still the right error, still decorated, and never a corrupted stack.
    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('boom');
    const rebuiltStack = (error as Error).stack;
    expect(rebuiltStack).toContain('S3VectorsError');
    // Whichever stack it ends up with, it carries real frames — a decorated
    // error whose stack is a header and a fragment points nowhere.
    expect(rebuiltStack).toContain('\n    at ');
  });
});
