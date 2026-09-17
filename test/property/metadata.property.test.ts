import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import fc from 'fast-check';

import { buildPutMetadata, createDocument } from '../../src/shared/metadata.js';

const KEY = '_page_content';
const SCOPE = { operation: 'addDocuments', vectorBucketName: 'b', indexName: 'i' } as const;

describe('metadata round-trip property', () => {
  it('preserves pageContent and user metadata for any string inputs', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((k) => k !== KEY),
          fc.string(),
        ),
        (pageContent, metadata) => {
          const put = buildPutMetadata(new Document({ pageContent, metadata }), {
            pageContentMetadataKey: KEY,
            nonFilterableKeys: [KEY],
            ...SCOPE,
            record: { recordIndex: 0 },
          });
          const doc = createDocument({ key: 'k', metadata: put }, KEY, SCOPE);
          expect(doc.pageContent).toBe(pageContent);
          expect(doc.metadata).toEqual(metadata);
        },
      ),
    );
  });
});
