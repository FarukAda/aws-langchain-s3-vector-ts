import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { createTestStore } from './helpers.js';

describe('AmazonS3Vectors.getByIds — ids are checked before any request (R6)', () => {
  it.each([
    ['empty', ''],
    ['over 1024 characters', 'x'.repeat(1025)],
    ['not a string', 7],
    ['not well-formed UTF-16', 'k\ud800'],
  ])('refuses an id that is %s, naming its position, and sends nothing', async (_label, bad) => {
    const { store, mock } = createTestStore();
    const error = await store.getByIds(['ok', bad as string]).catch((e: unknown) => e);
    expect((error as S3VectorsError).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as S3VectorsError).message).toContain('Vector id at index 1');
    expect((error as S3VectorsError).message).toContain('Ids were taken from the ids argument.');
    expect((error as S3VectorsError).context.recordIndex).toBe(1);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });
});

describe('AmazonS3Vectors.getByIds', () => {
  it('retrieves documents in input order', async () => {
    const { store, mock } = createTestStore();

    mock.on(GetVectorsCommand).resolves({
      vectors: [
        { key: 'id-2', metadata: { _page_content: 'second' } },
        { key: 'id-1', metadata: { _page_content: 'first' } },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-2']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('first');
    expect(docs[0]!.id).toBe('id-1');
    expect(docs[1]!.pageContent).toBe('second');
    expect(docs[1]!.id).toBe('id-2');
  });

  it('rejects a non-array ids argument with a coded VALIDATION error, not a raw TypeError', async () => {
    const { store } = createTestStore();

    const error = await store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally malformed input
      .getByIds('not-an-array' as any)
      .catch((e: unknown) => e);

    expect((error as { code: S3VectorsErrorCode }).code).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toBe('ids must be an array.');
  });
});

describe('AmazonS3Vectors.getByIds with duplicate IDs', () => {
  it('returns independent metadata for duplicate IDs', async () => {
    const { store, mock } = createTestStore();

    mock.on(GetVectorsCommand).resolves({
      vectors: [
        {
          key: 'id-1',
          metadata: {
            _page_content: 'hello',
            nested: { value: 'original' },
          },
        },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-1']);

    expect(docs).toHaveLength(2);
    expect(docs[0]!.pageContent).toBe('hello');
    expect(docs[1]!.pageContent).toBe('hello');

    // Mutating one document's metadata must not affect the other.
    (docs[0]!.metadata['nested'] as Record<string, string>).value = 'mutated';
    expect((docs[1]!.metadata['nested'] as Record<string, string>).value).toBe('original');
  });
});

describe('AmazonS3Vectors.getByIds batching and fallbacks', () => {
  it('honours an explicit batch size', async () => {
    const { store, mock } = createTestStore();

    mock.on(GetVectorsCommand).resolves({
      vectors: [
        { key: 'id-1', metadata: { _page_content: 'a' } },
        { key: 'id-2', metadata: { _page_content: 'b' } },
      ],
    });

    const docs = await store.getByIds(['id-1', 'id-2'], { batchSize: 1 });

    expect(docs).toHaveLength(2);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(2);
  });
});

describe('getByIds — partial-failure reporting', () => {
  it('reports ids already found via context.foundIds when a sibling batch in the same group fails', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(GetVectorsCommand, { keys: ['id-1'] })
      .resolves({ vectors: [{ key: 'id-1', metadata: { genre: 'a' } }] });
    const failure = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    mock.on(GetVectorsCommand, { keys: ['id-2'] }).rejects(failure);

    const error = await store.getByIds(['id-1', 'id-2'], { batchSize: 1 }).catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).context.foundIds).toEqual(['id-1']);
    expect((error as S3VectorsError).message).toContain('were already retrieved');
  });

  it('when two batches in the same group both fail, reports the first failure and still counts every found sibling', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake((input) => {
      const key = input.keys?.[0];
      if (key === 'id-2') throw new Error('first failure');
      if (key === 'id-3') throw new Error('second failure');
      return { vectors: [{ key, metadata: { genre: 'a' } }] };
    });

    const error = await store
      .getByIds(['id-1', 'id-2', 'id-3', 'id-4', 'id-5'], { batchSize: 1 })
      .catch((e: unknown) => e);

    expect(isS3VectorsError(error)).toBe(true);
    expect((error as S3VectorsError).message).toContain('first failure');
    expect((error as S3VectorsError).message).not.toContain('second failure');
    expect(new Set((error as S3VectorsError).context.foundIds)).toEqual(
      new Set(['id-1', 'id-4', 'id-5']),
    );
  });
});
