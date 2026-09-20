import { GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { flattenMetadata } from '../../src/shared/flatten-metadata.js';
import { BASE_CONFIG, createMockClient, indexFixture } from '../helpers.js';

const refusalOf = (run: () => unknown): S3VectorsError => {
  try {
    run();
  } catch (error: unknown) {
    return error as S3VectorsError;
  }
  throw new Error('expected a refusal');
};

describe('flattenMetadata', () => {
  it('flattens the metadata a text splitter adds to every chunk', () => {
    // @langchain/textsplitters gives each chunk `loc: { lines: { from, to } }`,
    // and S3 Vectors stores no nested object, under a filterable or a
    // non-filterable key (docs/evidence/metadata-value-types.md).
    expect(flattenMetadata({ source: 'a.txt', loc: { lines: { from: 1, to: 10 } } })).toEqual({
      source: 'a.txt',
      'loc.lines.from': 1,
      'loc.lines.to': 10,
    });
  });

  it('flattens a PDF loader document, dropping the fields it leaves empty', () => {
    expect(
      flattenMetadata({
        source: 'a.pdf',
        pdf: {
          version: '1.10.100',
          info: { Title: 't' },
          metadata: null,
          totalPages: 3,
        },
        loc: { pageNumber: 2 },
      }),
    ).toEqual({
      source: 'a.pdf',
      'pdf.version': '1.10.100',
      'pdf.info.Title': 't',
      'pdf.totalPages': 3,
      'loc.pageNumber': 2,
    });
  });

  it('keeps the values S3 Vectors stores as they are', () => {
    const metadata = {
      title: 'a',
      year: 2026,
      draft: false,
      tags: ['x', 'y'],
      scores: [1, 2.5],
    };
    expect(flattenMetadata(metadata)).toEqual(metadata);
  });

  it('drops what S3 Vectors has no representation for', () => {
    expect(
      flattenMetadata({
        absent: null,
        unset: undefined,
        none: [],
        empty: {},
        kept: 'yes',
      }),
    ).toEqual({ kept: 'yes' });
  });

  it('passes a value it cannot flatten through, so the write refuses it by name', () => {
    // Dropping a Date or a mixed array silently would lose data the caller
    // meant to store; the write path names the key and says what it takes.
    const date = new Date('2026-09-17T00:00:00Z');
    expect(flattenMetadata({ when: date, mixed: [1, 'a'] })).toEqual({
      when: date,
      mixed: [1, 'a'],
    });
  });

  it('refuses two fields that would flatten onto the same key', () => {
    const error = refusalOf(() => flattenMetadata({ 'loc.pageNumber': 1, loc: { pageNumber: 2 } }));
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('loc.pageNumber');
  });

  it('refuses a circular reference rather than recursing forever', () => {
    const metadata: Record<string, unknown> = { name: 'a' };
    metadata['self'] = metadata;
    const error = refusalOf(() => flattenMetadata(metadata));
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('self');
  });

  it('leaves the caller their own object, unchanged', () => {
    const nested = { lines: { from: 1, to: 10 } };
    const metadata = { loc: nested };
    const flattened = flattenMetadata(metadata);
    flattened['loc.lines.from'] = 99;
    expect(metadata).toEqual({ loc: { lines: { from: 1, to: 10 } } });
    expect(nested.lines.from).toBe(1);
  });

  it('refuses metadata that is not an object', () => {
    expect(refusalOf(() => flattenMetadata(null as never)).code).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it('keeps a __proto__ key as an own key instead of losing it', () => {
    // `flat[path] = value` invokes Object.prototype's __proto__ setter, which
    // is not a property write: the field vanishes, and the guarantee that
    // every other value is "passed through untouched" is broken silently. The
    // key is reachable from `JSON.parse`, so this is ordinary loader input.
    const flattened = flattenMetadata(JSON.parse('{"__proto__":"keep me","other":1}'));
    expect(Object.hasOwn(flattened, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(flattened, '__proto__')?.value).toBe('keep me');
    expect(flattened['other']).toBe(1);
  });

  it('does not let a __proto__ value become the returned object’s prototype', () => {
    const flattened = flattenMetadata(JSON.parse('{"__proto__":[1,2,3]}'));
    expect(Object.getPrototypeOf(flattened)).toBe(Object.prototype);
  });

  it('still refuses a real collision when a __proto__ key is also present', () => {
    // The collision guard reads own keys; switching the write to
    // defineProperty must not leave it reading something else.
    const refusal = refusalOf(() =>
      flattenMetadata(JSON.parse('{"__proto__":1,"a.b":2,"a":{"b":3}}')),
    );
    expect(refusal.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(refusal.message).toContain("'a.b'");
  });

  it('refuses metadata nested deeper than it can walk, with a coded error', () => {
    // 6000 levels overflows the stack in the recursive walk. A raw RangeError
    // escapes isS3VectorsError, breaking the promise that every failure here
    // is coded. Reachable from JSON.parse, whose parser is iterative.
    let json = '1';
    for (let depth = 0; depth < 6000; depth += 1) json = `{"a":${json}}`;
    const refusal = refusalOf(() => flattenMetadata(JSON.parse(json)));
    expect(refusal.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(refusal.message).toMatch(/nest/i);
  });

  it('refuses metadata that expands combinatorially through shared references', () => {
    // `ancestors` is a path set, so it catches a true cycle but reads a shared
    // reference as a tree: 22 levels of { a: n, b: n } is 4.2M keys and ~860 MB.
    // Not reachable from JSON.parse, which cannot alias — but a YAML loader
    // with anchors, structuredClone, or assembled metadata all produce it.
    let node: Record<string, unknown> = { leaf: 1 };
    for (let depth = 0; depth < 22; depth += 1) node = { a: node, b: node };
    const refusal = refusalOf(() => flattenMetadata(node));
    expect(refusal.code).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('flattenMetadata with the write path', () => {
  it('makes a text splitter document writable, which it is not without it', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    const store = new AmazonS3Vectors(undefined, { ...BASE_CONFIG, client });
    // What `splitDocuments` hands back, verbatim.
    const chunk = new Document({
      pageContent: 'a chunk',
      metadata: { source: 'a.txt', loc: { lines: { from: 1, to: 10 } } },
    });

    await expect(store.addVectors([[0.1, 0.2]], [chunk])).rejects.toMatchObject({
      code: S3VectorsErrorCode.VALIDATION,
    });

    await store.addVectors(
      [[0.1, 0.2]],
      [new Document({ pageContent: chunk.pageContent, metadata: flattenMetadata(chunk.metadata) })],
    );

    expect(mock.commandCalls(PutVectorsCommand)).toHaveLength(1);
    expect(mock.commandCalls(PutVectorsCommand)[0]!.args[0].input.vectors![0]!.metadata).toEqual({
      source: 'a.txt',
      'loc.lines.from': 1,
      'loc.lines.to': 10,
      _page_content: 'a chunk',
    });
  });
});
