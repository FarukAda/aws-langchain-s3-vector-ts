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
