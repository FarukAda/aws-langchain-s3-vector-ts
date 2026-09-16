import { GetVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { createTestStore } from './helpers.js';

/**
 * `getByIds` returns one slot per requested id. Absence is an ordinary state
 * of the world, so it is `undefined` in that slot rather than an exception; an
 * error now means the request actually failed.
 */
const awsError = (name: string): Error => Object.assign(new Error(`synthetic ${name}`), { name });
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

/** Return only the keys named present, echoing metadata. */
const respondWith =
  (present: Record<string, Record<string, unknown>>) => (input: { keys: string[] }) => ({
    vectors: input.keys.filter((k) => k in present).map((k) => ({ key: k, metadata: present[k] })),
  });

describe('getByIds — aligned slots', () => {
  it('returns one slot per requested id, in request order', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake(respondWith({ a: {}, b: {}, c: {} }));
    const docs = await store.getByIds(['c', 'a', 'b']);
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d?.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves undefined where an id is not there, rather than throwing', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake(respondWith({ a: {}, c: {} }));
    const docs = await store.getByIds(['a', 'gone', 'c']);
    expect(docs).toHaveLength(3);
    expect(docs[1]).toBeUndefined();
    expect(docs[0]?.id).toBe('a');
    expect(docs[2]?.id).toBe('c');
  });

  it('returns all-undefined when nothing requested exists', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake(respondWith({}));
    expect(await store.getByIds(['x', 'y'])).toEqual([undefined, undefined]);
  });

  it('returns an empty array and issues no request for no ids', async () => {
    const { store, mock } = createTestStore();
    expect(await store.getByIds([])).toEqual([]);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });

  it('rejects a non-array ids argument', async () => {
    const { store } = createTestStore();
    const error = await store.getByIds('abc' as unknown as string[]).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('still throws when the request itself fails, because unknown is not absent', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).rejects(awsError('AccessDeniedException'));
    const error = await store.getByIds(['a']).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
  });
});

describe('getByIds — every document owns its metadata', () => {
  it('gives duplicate ids independent documents, so mutating one cannot affect another', async () => {
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake(respondWith({ a: { nested: { n: 1 } } }));

    const docs = await store.getByIds(['a', 'a']);
    expect(docs[0]?.metadata['nested']).not.toBe(docs[1]?.metadata['nested']);

    (docs[0]?.metadata['nested'] as { n: number }).n = 99;
    expect((docs[1]?.metadata['nested'] as { n: number }).n).toBe(1);
  });

  it('deep-copies nested metadata even for a single id, so no aliasing is possible', async () => {
    const shared = { nested: { n: 1 } };
    const { store, mock } = createTestStore();
    mock.on(GetVectorsCommand).callsFake(() => ({
      vectors: [{ key: 'a', metadata: shared }],
    }));

    const [doc] = await store.getByIds(['a']);
    expect(doc?.metadata['nested']).not.toBe(shared.nested);
  });

  it('round-trips page content out of metadata', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(GetVectorsCommand)
      .callsFake(respondWith({ a: { _page_content: 'hello', genre: 'scifi' } }));
    const [doc] = await store.getByIds(['a']);
    expect(doc?.pageContent).toBe('hello');
    expect(doc?.metadata).toEqual({ genre: 'scifi' });
  });
});
