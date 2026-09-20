import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { prepareRecords } from '../../src/internal/records.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import type { S3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';

const CONFIG = {
  operation: 'addDocuments',
  vectorBucketName: 'b',
  indexName: 'i',
  pageContentMetadataKey: '_page_content',
  nonFilterableMetadataKeys: ['_page_content'],
} as const;

describe('prepareRecords', () => {
  it('builds one record per document, in order, with its key, text and metadata', () => {
    const records = prepareRecords(
      [
        new Document({ pageContent: 'one', metadata: { n: 1 } }),
        new Document({ pageContent: 'two' }),
      ],
      ['a', 'b'],
      CONFIG,
    );
    expect(records).toEqual([
      {
        key: 'a',
        text: 'one',
        metadata: { n: 1, _page_content: 'one' },
        metadataBytes: expect.any(Number),
      },
      {
        key: 'b',
        text: 'two',
        metadata: { _page_content: 'two' },
        metadataBytes: expect.any(Number),
      },
    ]);
  });

  it('takes the text once, so a later change to the document changes neither what is embedded nor what is stored', () => {
    const document = new Document({ pageContent: 'before' });
    const [record] = prepareRecords([document], ['a'], CONFIG);
    document.pageContent = 'after';
    expect(record!.text).toBe('before');
    expect(record!.metadata['_page_content']).toBe('before');
  });

  it('refuses the first document S3 Vectors cannot store, by its position and id in the whole input', () => {
    let thrown: unknown;
    try {
      prepareRecords(
        [
          new Document({ pageContent: 'ok' }),
          new Document({ pageContent: 'ok' }),
          new Document({ pageContent: 'bad', metadata: { category: null } }),
        ],
        ['a', 'b', 'c'],
        CONFIG,
      );
    } catch (error: unknown) {
      thrown = error;
    }
    const error = thrown as S3VectorsError;
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toMatch(/^Document at index 2 \(id "c"\): /);
    expect(error.context).toMatchObject({
      operation: 'addDocuments',
      recordIndex: 2,
      recordId: 'c',
    });
  });

  it('returns an empty list for no documents', () => {
    expect(prepareRecords([], [], CONFIG)).toEqual([]);
  });
});

describe('prepareRecords — request budgeting', () => {
  it('carries the metadata size each write is measured with', () => {
    const records = prepareRecords(
      [new Document({ pageContent: 'one', metadata: { n: 1 } })],
      ['a'],
      CONFIG,
    );
    expect(records[0]!.metadataBytes).toBe(
      Buffer.byteLength(JSON.stringify(records[0]!.metadata), 'utf8') + 5,
    );
  });
});
