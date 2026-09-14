import { ListVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createTestStore } from './helpers.js';

/**
 * Enumeration (DESIGN.md §6.7, D-25). Two methods rather than one with a flag
 * (D-27): "sometimes there is a vector on the result" is the optional-field
 * ambiguity the contract standard exists to prevent, and the 1 MB page cap
 * makes them economically different operations.
 */
const page = (keys: string[], withData: boolean, nextToken?: string): object => ({
  vectors: keys.map((key) => ({
    key,
    metadata: { _page_content: `content ${key}`, tag: key },
    ...(withData ? { data: { float32: [1, 2, 3] } } : {}),
  })),
  ...(nextToken === undefined ? {} : { nextToken }),
});

describe('listDocuments', () => {
  it('yields a Document per stored vector, with page content extracted', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a', 'b'], false));

    const docs = [];
    for await (const doc of store.listDocuments()) docs.push(doc);

    expect(docs).toHaveLength(2);
    expect(docs[0]?.pageContent).toBe('content a');
    expect(docs[0]?.metadata).toEqual({ tag: 'a' });
    expect(docs[0]?.id).toBe('a');
  });

  it('asks for metadata but not vector data, which is the cheaper page', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], false));
    for await (const _doc of store.listDocuments()) break;
    expect(mock.commandCalls(ListVectorsCommand)[0]!.args[0].input).toMatchObject({
      returnData: false,
      returnMetadata: true,
    });
  });

  it('spans pages', async () => {
    const { store, mock } = createTestStore();
    mock
      .on(ListVectorsCommand)
      .resolvesOnce(page(['a'], false, 't1'))
      .resolves(page(['b'], false));
    const ids = [];
    for await (const doc of store.listDocuments()) ids.push(doc.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('stops issuing requests when the consumer stops', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).callsFake(() => page(['a'], false, 'more'));
    for await (const _doc of store.listDocuments()) break;
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(1);
  });
});

describe('listVectors', () => {
  it('yields the id, the vector and the document together', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], true));

    const records = [];
    for await (const record of store.listVectors()) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('a');
    expect(records[0]?.vector).toEqual([1, 2, 3]);
    expect(records[0]?.document.pageContent).toBe('content a');
  });

  it('asks for vector data, which is what makes a copy to a new index possible', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], true));
    for await (const _record of store.listVectors()) break;
    expect(mock.commandCalls(ListVectorsCommand)[0]!.args[0].input).toMatchObject({
      returnData: true,
      returnMetadata: true,
    });
  });

  it('rejects a record returned without data despite asking for it', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], false));
    const error = await (async () => {
      try {
        for await (const _record of store.listVectors()) break;
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect((error as { code?: string }).code).toBe('AWS_INVALID_RESPONSE');
  });

  it('honours a caller page size', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], true));
    for await (const _record of store.listVectors({ pageSize: 10 })) break;
    expect(mock.commandCalls(ListVectorsCommand)[0]!.args[0].input).toMatchObject({
      maxResults: 10,
    });
  });
});
