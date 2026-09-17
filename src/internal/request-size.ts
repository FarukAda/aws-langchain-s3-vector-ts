import type { StoreScope } from './signals.js';

/**
 * The largest request body S3 Vectors accepts, in bytes.
 *
 * "Request payload size: Up to 20 MiB" (limits page,
 * `s3-vectors-limitations.html`), and the ceiling is **inclusive**: a body of
 * exactly this many bytes was accepted and one byte more was refused with
 * `ValidationException` "Request body exceeds max allowed size"
 * (`docs/evidence/request-payload-limit.md`).
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html
 */
export const MAX_REQUEST_BODY_BYTES = 20 * 1024 * 1024;

/**
 * Upper bound on the bytes one vector component adds to the body.
 *
 * The longest `JSON.stringify` form of a finite number is 25 characters —
 * measured over three million sampled `float32` bit patterns, three million
 * sampled doubles, and the extremes of both ranges — and each component but the
 * last is followed by a comma. So 26 bounds any component this package can
 * send, whether the caller passed `float32`-derived values or arbitrary
 * doubles.
 */
export const MAX_COMPONENT_BYTES = 26;

/**
 * The bytes an entry adds beyond its components, its key and its metadata:
 * `{"key":`, `,"data":{"float32":[`, `]}`, `,"metadata":`, `}`, and the comma
 * that separates it from the next entry.
 */
const ENTRY_FIXED_BYTES = 43;

/** What the size of one pending write is decided from. */
export interface RecordSize {
  /** The vector key, counted as the JSON string it is sent as. */
  readonly key: string;
  /** The bytes its metadata serialises to, as `buildPutMetadata` measured it. */
  readonly metadataBytes: number;
}

/**
 * The bytes of a `PutVectors` body that are not vectors.
 *
 * Accepts: the bucket and index every request names.
 *
 * Returns: the exact byte count of the request with an empty `vectors` list.
 * The SDK's body is byte-identical to `JSON.stringify` of the command input —
 * its JSON serialiser stringifies the whole input and the client registers no
 * compression — so this is measured rather than estimated
 * (`docs/evidence/request-payload-limit.md`). That assumption is the one this
 * whole module rests on, so it is guarded executably rather than by comment:
 * `test/contract/request-body-is-json.test.ts` fails if a future SDK ever
 * serialises a `PutVectors` body any other way.
 *
 * Throws: nothing.
 */
export function envelopeBytes(scope: StoreScope): number {
  return Buffer.byteLength(
    JSON.stringify({
      vectors: [],
      vectorBucketName: scope.vectorBucketName,
      indexName: scope.indexName,
    }),
    'utf8',
  );
}

/**
 * Upper bound on the bytes one record adds to a `PutVectors` body.
 *
 * Accepts: the record's key and measured metadata size, and the dimension of
 * the vector it will be written with.
 *
 * Returns: a count that is never below what the request will actually carry,
 * and about 10–14% above it in practice.
 *
 * Throws: nothing.
 *
 * Guarantees: it never underestimates, which is what lets a split computed from
 * it land under {@link MAX_REQUEST_BODY_BYTES} without serialising the batch a
 * second time to find out. Serialising to measure exactly costs 18 ms for 200
 * records of 1,024 dimensions and 135 ms for 500 of 3,072 — on every write,
 * for a limit almost no write approaches. The bound is arithmetic on numbers
 * the write path already has.
 */
export function recordBytesUpperBound(record: RecordSize, dimension: number): number {
  return (
    dimension * MAX_COMPONENT_BYTES +
    record.metadataBytes +
    Buffer.byteLength(JSON.stringify(record.key), 'utf8') +
    ENTRY_FIXED_BYTES
  );
}
