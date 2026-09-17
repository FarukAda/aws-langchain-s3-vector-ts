import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';

import { envelopeBytes, recordBytesUpperBound } from '../../src/internal/request-size.js';

const SCOPE = { vectorBucketName: 'bucket-name', indexName: 'index.name' } as const;

/** A metadata value S3 Vectors stores: a string, a finite number or a boolean. */
const metadataValue = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.array(fc.string(), { minLength: 1, maxLength: 4 }),
);

/** Components spanning the ranges whose JSON forms are longest: subnormals and tiny magnitudes. */
const component = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -1e-6, max: 1e-6, noNaN: true }),
  fc.double({ min: -5e-320, max: 5e-320, noNaN: true }),
  fc.constantFrom(0, -0, 1e-7, -1.401298464324817e-45, 3.4028234663852886e38),
);

describe('request size bound property', () => {
  it('never reports fewer bytes than the request actually carries', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 40 }),
            metadata: fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), metadataValue, {
              maxKeys: 6,
            }),
            components: fc.array(component, { minLength: 1, maxLength: 24 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (records) => {
          // One dimension per request, as a real index has.
          const dimension = records[0]!.components.length;
          const vectors = records.map((record) => ({
            key: record.key,
            data: { float32: record.components.slice(0, dimension) },
            metadata: record.metadata,
          }));
          const actual = Buffer.byteLength(JSON.stringify({ vectors, ...SCOPE }), 'utf8');
          const bound =
            envelopeBytes(SCOPE) +
            records.reduce(
              (sum, record, index) =>
                sum +
                recordBytesUpperBound(
                  {
                    key: record.key,
                    metadataBytes: Buffer.byteLength(
                      JSON.stringify(vectors[index]!.metadata),
                      'utf8',
                    ),
                  },
                  dimension,
                ),
              0,
            );
          expect(bound).toBeGreaterThanOrEqual(actual);
        },
      ),
      { numRuns: 500 },
    );
  });
});
