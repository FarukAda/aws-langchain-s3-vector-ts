import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import fc from 'fast-check';

import { parseFilter } from '../../src/internal/filter.js';
import { resolveWriteIds } from '../../src/internal/ids.js';
import { chunk, offsetBatches } from '../../src/shared/batching.js';
import { classifyAwsError } from '../../src/shared/errors/classify.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { toError } from '../../src/shared/errors/wrap-error.js';
import { createDocument } from '../../src/shared/metadata.js';

/**
 * Properties over whole input domains, where a per-cell example cannot reach.
 *
 * A contract cell names one distinguishable state; these assert the invariant
 * that has to hold across every state in a domain — totality, round-tripping,
 * the absence of a raw throw. They are the only honest answer to "what about
 * inputs nobody wrote a test for".
 */
const SCOPE = { vectorBucketName: 'bucket', indexName: 'index' } as const;

/** Any JavaScript value, including the ones a typed caller cannot produce. */
const anything = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.anything(),
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(Number.NaN),
    fc.func(fc.constant(1)),
    fc.date(),
    fc.bigInt(),
    fc.string().map((s) => new Error(s)),
  );

describe('chunk / offsetBatches', () => {
  it('splits and rejoins to the original, for any array and any valid size', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 200 }),
        fc.integer({ min: 1, max: 50 }),
        (items, size) => {
          const batches = chunk(items, size);
          expect(batches.flat()).toEqual(items);
          expect(batches.every((b) => b.length > 0 && b.length <= size)).toBe(true);
          // Only the last batch may be short.
          expect(batches.slice(0, -1).every((b) => b.length === size)).toBe(true);
        },
      ),
    );
  });

  it('offsets always index back into the array the batches came from', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 200 }),
        fc.integer({ min: 1, max: 50 }),
        (items, size) => {
          for (const { batch, offset } of offsetBatches(chunk(items, size), 0)) {
            expect(items.slice(offset, offset + batch.length)).toEqual(batch);
          }
        },
      ),
    );
  });

  it('rejects every size below one, rather than looping', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 20 }),
        fc.integer({ max: 0 }),
        (items, size) => {
          expect(() => chunk(items, size)).toThrow();
        },
      ),
    );
  });
});

describe('resolveWriteIds', () => {
  it('returns one id per document, whatever mix of sources they come from', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.string({ minLength: 1 }), { nil: undefined }), { maxLength: 30 }),
        (docIds) => {
          const docs = docIds.map((id) => {
            const doc = new Document({ pageContent: 'x' });
            if (id !== undefined) doc.id = id;
            return doc;
          });
          const resolved = resolveWriteIds(docs, undefined);
          expect(resolved).toHaveLength(docs.length);
          expect(resolved.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
          // A document's own id is what it is written under; only a document
          // without one gets a generated key.
          docIds.forEach((id, i) => {
            if (id !== undefined) expect(resolved[i]).toBe(id);
          });
        },
      ),
    );
  });

  it('prefers the caller list over the documents, position for position', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }), (ids) => {
        const docs = ids.map(() => {
          const doc = new Document({ pageContent: 'x' });
          doc.id = 'from-the-document';
          return doc;
        });
        expect(resolveWriteIds(docs, ids)).toEqual(ids);
      }),
    );
  });

  it('generates distinct ids when no document carries one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const docs = Array.from({ length: n }, () => new Document({ pageContent: 'x' }));
        const resolved = resolveWriteIds(docs, undefined);
        expect(new Set(resolved).size).toBe(n);
      }),
    );
  });
});

describe('parseFilter', () => {
  it('never throws anything but a coded S3VectorsError, for any input at all', () => {
    fc.assert(
      fc.property(anything(), (filter) => {
        try {
          parseFilter(filter, 'similaritySearch', SCOPE);
        } catch (error: unknown) {
          expect(isS3VectorsError(error)).toBe(true);
          expect((error as { code: string }).code).toBe(S3VectorsErrorCode.VALIDATION);
          expect((error as { context: { operation: string } }).context.operation).toBe(
            'similaritySearch',
          );
        }
      }),
    );
  });

  it('accepts any filter built only from documented operators', () => {
    const literal = fc.oneof(fc.string(), fc.integer(), fc.boolean());
    const comparison = fc.oneof(
      fc.record({ $eq: literal }),
      fc.record({ $ne: literal }),
      fc.record({ $gt: fc.integer() }),
      fc.record({ $gte: fc.integer() }),
      fc.record({ $lt: fc.integer() }),
      fc.record({ $lte: fc.integer() }),
      fc.record({ $in: fc.array(literal, { minLength: 1, maxLength: 4 }) }),
      fc.record({ $nin: fc.array(literal, { minLength: 1, maxLength: 4 }) }),
      fc.record({ $exists: fc.boolean() }),
    );
    // One key per condition object: S3 Vectors rejects more (docs/evidence/filter-validation.md, T3-17).
    const field = fc.dictionary(
      fc.string({ minLength: 1 }).filter((k) => !k.startsWith('$')),
      fc.oneof(literal, comparison),
      {
        minKeys: 1,
        maxKeys: 1,
      },
    );
    const nested = fc.oneof(
      field,
      fc.record({ $and: fc.array(field, { minLength: 1, maxLength: 3 }) }),
      fc.record({ $or: fc.array(field, { minLength: 1, maxLength: 3 }) }),
    );

    fc.assert(
      fc.property(nested, (filter) => {
        expect(() => {
          parseFilter(filter, 'similaritySearch', SCOPE);
        }).not.toThrow();
      }),
    );
  });

  it('rejects any unknown $-prefixed operator, wherever it appears', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-z]+$/i.test(s)),
        (word) => {
          const unknown = `$${word}`;
          fc.pre(
            ![
              '$eq',
              '$ne',
              '$gt',
              '$gte',
              '$lt',
              '$lte',
              '$in',
              '$nin',
              '$exists',
              '$and',
              '$or',
            ].includes(unknown),
          );
          expect(() => {
            parseFilter({ field: { [unknown]: 'x' } }, 'similaritySearch', SCOPE);
          }).toThrow(unknown);
        },
      ),
    );
  });
});

describe('classifyAwsError', () => {
  it('is total: every value yields a code from the enum, and nothing throws', () => {
    const codes = new Set<string>(Object.values(S3VectorsErrorCode));
    fc.assert(
      fc.property(anything(), (value) => {
        const code = classifyAwsError(value);
        expect(codes.has(code)).toBe(true);
      }),
    );
  });

  it('classifies by the exception name, whatever else the object carries', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string(), { maxKeys: 5 }), (extra) => {
        const error = Object.assign(new Error('x'), extra, { name: 'AccessDeniedException' });
        expect(classifyAwsError(error)).toBe(S3VectorsErrorCode.ACCESS_DENIED);
      }),
    );
  });
});

describe('toError', () => {
  it('always returns an Error, and returns Error-shaped input unchanged', () => {
    fc.assert(
      fc.property(anything(), (value) => {
        const error = toError(value);
        expect(error).toBeInstanceOf(Error);
        expect(typeof error.message).toBe('string');
        if (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as { name?: unknown }).name === 'string' &&
          typeof (value as { message?: unknown }).message === 'string'
        ) {
          expect(toError(value)).toBe(value);
        }
      }),
    );
  });
});

describe('createDocument', () => {
  const SCOPE = { operation: 'listDocuments', vectorBucketName: 'b', indexName: 'i' } as const;

  it('round-trips page content and leaves the rest of the metadata alone', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((k) => k !== '_page_content'),
          fc.string(),
          {
            maxKeys: 5,
          },
        ),
        fc.string({ minLength: 1 }),
        (pageContent, metadata, key) => {
          const doc = createDocument(
            { key, metadata: { ...metadata, _page_content: pageContent } },
            '_page_content',
            SCOPE,
          );
          expect(doc.pageContent).toBe(pageContent);
          expect(doc.metadata).toEqual(metadata);
          expect(doc.id).toBe(key);
        },
      ),
    );
  });

  it('never shares mutable metadata between two documents built from one vector', () => {
    // Nested values are the case a shallow copy would miss: an array under a
    // metadata key is one object, and two documents holding the same one are
    // one mutation away from silently changing each other.
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.array(fc.string(), { maxLength: 3 }), {
          minKeys: 1,
          maxKeys: 4,
        }),
        (meta) => {
          const vector = { key: 'k', metadata: structuredClone(meta) };
          const first = createDocument(vector, null, SCOPE);
          const second = createDocument(vector, null, SCOPE);
          const key = Object.keys(meta)[0]!;
          (first.metadata[key] as string[]).push('mutated');
          expect(second.metadata[key]).toEqual(meta[key]);
        },
      ),
    );
  });
});
