import { ListVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { createTestStore, sendOptionsOf } from './helpers.js';

/**
 * Enumeration. Two methods rather than one with a flag: "sometimes there is a
 * vector on the result" is the optional-field ambiguity the contract standard
 * exists to prevent, and the 1 MB page cap makes them economically different
 * operations.
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

describe('enumeration and the signal', () => {
  it.each([
    [
      'listDocuments',
      (store: ReturnType<typeof createTestStore>['store'], signal: AbortSignal) =>
        store.listDocuments({ signal }),
    ],
    [
      'listVectors',
      (store: ReturnType<typeof createTestStore>['store'], signal: AbortSignal) =>
        store.listVectors({ signal }),
    ],
  ])('%s rejects ABORTED on an already-fired signal, without a request', async (_label, start) => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], true));
    const controller = new AbortController();
    controller.abort();

    const error = await (async () => {
      try {
        for await (const _item of start(store, controller.signal)) break;
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    expect((error as { code?: string }).code).toBe('ABORTED');
    expect(mock.commandCalls(ListVectorsCommand)).toHaveLength(0);
  });

  it('threads the signal into the ListVectors request, so an abort cancels it', async () => {
    const { store, mock } = createTestStore();
    mock.on(ListVectorsCommand).resolves(page(['a'], false));
    const controller = new AbortController();
    for await (const _doc of store.listDocuments({ signal: controller.signal })) break;
    expect(sendOptionsOf(mock.commandCalls(ListVectorsCommand)[0]!)?.abortSignal).toBe(
      controller.signal,
    );
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
    // Names the record and says the request did ask for data, so the caller
    // can tell this from having forgotten to.
    expect((error as Error).message).toContain(
      "ListVectors returned vector 'a' without data, even though this call requested " +
        'returnData: true. The response may be malformed, or come from an incompatible SDK ' +
        'version or a mocked/stubbed client.',
    );
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
