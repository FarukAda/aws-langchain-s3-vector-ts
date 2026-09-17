import { describe, it, expect } from '@jest/globals';

import {
  MAX_COMPONENT_BYTES,
  MAX_REQUEST_BODY_BYTES,
  envelopeBytes,
  recordBytesUpperBound,
  requestRuns,
} from '../../src/internal/request-size.js';
import { MAX_DIMENSION } from '../../src/shared/aws-limits.js';

const SCOPE = { vectorBucketName: 'langchain-vectors-ci', indexName: 'probe-payload' } as const;

/** The body the SDK sends: byte-identical to `JSON.stringify` of the command input. */
function bodyBytes(vectors: unknown[]): number {
  return Buffer.byteLength(JSON.stringify({ vectors, ...SCOPE }), 'utf8');
}

function entry(key: string, dimension: number, metadata: Record<string, unknown>): unknown {
  const data = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) data[i] = Math.sin(i * 0.37) * 0.05 + 0.001;
  return { key, data: { float32: Array.from(data) }, metadata };
}

/** What `buildPutMetadata` reports for a metadata object, as the record carries it. */
function metadataBytes(metadata: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(metadata), 'utf8');
}

describe('request-size limits', () => {
  it('caps a request body at the 20 MiB AWS accepts inclusively', () => {
    // Live: 20,971,520 bytes → 200 OK; one byte more → ValidationException
    // "Request body exceeds max allowed size" (docs/evidence/request-payload-limit.md).
    expect(MAX_REQUEST_BODY_BYTES).toBe(20 * 1024 * 1024);
  });

  it('bounds one vector component at 26 bytes', () => {
    // The longest JSON form of a finite number is 25 characters, plus its separator.
    expect(MAX_COMPONENT_BYTES).toBe(26);
  });
});

describe('envelopeBytes', () => {
  it('counts exactly the part of the body that is not vectors', () => {
    expect(envelopeBytes(SCOPE)).toBe(bodyBytes([]));
  });

  it('grows with the bucket and index names, which travel in every request', () => {
    const longer = { vectorBucketName: 'a'.repeat(63), indexName: 'b'.repeat(63) };
    expect(envelopeBytes(longer)).toBe(
      Buffer.byteLength(JSON.stringify({ vectors: [], ...longer })),
    );
    expect(envelopeBytes(longer)).toBeGreaterThan(envelopeBytes(SCOPE));
  });
});

describe('recordBytesUpperBound', () => {
  it('never underestimates a small record', () => {
    const metadata = { n: 1, flag: true, _page_content: 'hello' };
    const bound = recordBytesUpperBound({ key: 'k1', metadataBytes: metadataBytes(metadata) }, 4);
    expect(envelopeBytes(SCOPE) + bound).toBeGreaterThanOrEqual(
      bodyBytes([entry('k1', 4, metadata)]),
    );
  });

  it('never underestimates metadata and keys that need escaping or multi-byte encoding', () => {
    const metadata = { 'héllo "quoted"': 'wörld\n', list: ['é', '🙂'] };
    const key = 'id "with" \\ escapes 🙂';
    const bound = recordBytesUpperBound({ key, metadataBytes: metadataBytes(metadata) }, 8);
    expect(envelopeBytes(SCOPE) + bound).toBeGreaterThanOrEqual(
      bodyBytes([entry(key, 8, metadata)]),
    );
  });

  it('never underestimates a 4,096-dimension record carrying 39 KB of page content', () => {
    const metadata = { _page_content: 'x'.repeat(39000) };
    const bound = recordBytesUpperBound(
      { key: 'v-167', metadataBytes: metadataBytes(metadata) },
      MAX_DIMENSION,
    );
    expect(envelopeBytes(SCOPE) + bound).toBeGreaterThanOrEqual(
      bodyBytes([entry('v-167', MAX_DIMENSION, metadata)]),
    );
  });

  it('reports the default batch of 200 such records as over the limit', () => {
    // The F1 case: 200 × 4,096 dimensions × 39 KB content is 23.9 MiB on the wire.
    const metadata = { _page_content: 'x'.repeat(39000) };
    const bound = recordBytesUpperBound(
      { key: 'v-0', metadataBytes: metadataBytes(metadata) },
      MAX_DIMENSION,
    );
    expect(envelopeBytes(SCOPE) + bound * 200).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
  });

  it('leaves every record this package can write able to travel alone', () => {
    // The largest record the write path accepts: the maximum dimension, the
    // maximum metadata, the maximum key. Splitting can always make progress.
    const bound = recordBytesUpperBound(
      { key: 'k'.repeat(1024), metadataBytes: 40_965 },
      MAX_DIMENSION,
    );
    expect(envelopeBytes(SCOPE) + bound).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });
});

describe('requestRuns', () => {
  const record = (key: string, metadataBytes = 10): { key: string; metadataBytes: number } => ({
    key,
    metadataBytes,
  });

  it('has nothing to send for no records', () => {
    expect(requestRuns([], 4, 200, SCOPE)).toEqual([]);
  });

  it('keeps a batch that fits as a single request', () => {
    const records = [record('a'), record('b'), record('c')];
    expect(requestRuns(records, 4, 200, SCOPE)).toEqual([records]);
  });

  it('splits by the caller batch size first', () => {
    const records = [record('a'), record('b'), record('c')];
    expect(requestRuns(records, 4, 2, SCOPE)).toEqual([[records[0], records[1]], [records[2]]]);
  });

  it('splits by size when the records are large, whatever the batch size allows', () => {
    // Eight megabytes of metadata each: two fit one request, three do not.
    const records = [
      record('a', 8 * 1024 * 1024),
      record('b', 8 * 1024 * 1024),
      record('c', 8 * 1024 * 1024),
    ];
    const runs = requestRuns(records, 4, 200, SCOPE);
    expect(runs.map((run) => run.length)).toEqual([2, 1]);
  });

  it('gives a record that fills a request on its own one of its own', () => {
    const records = [record('a', 19 * 1024 * 1024), record('b', 19 * 1024 * 1024)];
    expect(requestRuns(records, 4, 200, SCOPE).map((run) => run.length)).toEqual([1, 1]);
  });
});
