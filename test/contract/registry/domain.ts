/**
 * The accepted domain of every registered entry point, stated once.
 *
 * Written from the AWS documentation and the probes recorded under
 * `docs/evidence/`, never from `src/`: a predicate that called the validator
 * under test could only ever agree with it. Each entry composes these into its
 * own `accepts`.
 */

/** "Keys per DeleteVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
export const MAX_DELETE_BATCH_SIZE = 500;
/** The store's default `maxConcurrentBatchCalls`. */
export const DEFAULT_MAX_CONCURRENT = 10;
/** "Vectors per GetVectors API call: Up to 100" (limits page). */
export const MAX_GET_BATCH_SIZE = 100;

/** "Vectors per PutVectors call: 500" (limits page). */
const MAX_PUT_BATCH_SIZE = 500;
/** The page-content key every harness store writes under: the default. */
const PAGE_CONTENT_KEY = '_page_content';
/** A vector key is 1–1024 characters (`API_S3VectorBuckets_PutInputVector.html`). */
const KEY_MAX_LENGTH = 1024;
/** Dimension bounds (limits page). */
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;

/** An object a call can read properties from: not `null`, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `undefined`, or `null` — which this package reads as "not provided" throughout. */
export function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

/** `AbortSignal`-shaped: a boolean `aborted` and an `addEventListener`. */
function isAbortSignalLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { aborted?: unknown; addEventListener?: unknown };
  return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

/** Absent, or an `AbortSignal`. */
export function isOptionalSignal(value: unknown): boolean {
  return isAbsent(value) || isAbortSignalLike(value);
}

/** Absent, or an integer from 1 to `max`. */
export function isOptionalIntegerUpTo(value: unknown, max: number): boolean {
  return (
    isAbsent(value) ||
    (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max)
  );
}

/** A string S3 Vectors can decode (docs/evidence/string-encoding.md, T3-15). */
function isWellFormedString(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed();
}

/** A vector key: a well-formed string of 1–1024 characters. */
function isWellFormedKey(value: unknown): boolean {
  return isWellFormedString(value) && value.length >= 1 && value.length <= KEY_MAX_LENGTH;
}

/** A list of vector keys, repeats allowed — what `GetVectors` takes. Indexed, so a hole counts. */
export function isKeyList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (!isWellFormedKey(value[index])) return false;
  }
  return true;
}

/**
 * A list of vector keys with no repeats — what a write and a delete take. A
 * repeat loses a document on a write (the later vector overwrites the earlier)
 * and is refused outright by `DeleteVectors`.
 */
export function isUniqueKeyList(value: unknown): boolean {
  if (!isKeyList(value)) return false;
  const ids = value as unknown[];
  return new Set(ids).size === ids.length;
}

/**
 * A metadata value S3 Vectors stores as written: a well-formed string, a
 * boolean, a finite number (the SDK sends a non-finite one as a string), or a
 * non-empty array whose elements are all well-formed strings or all finite
 * numbers — no holes, no mixing (docs/evidence/metadata-value-types.md, T3-9
 * and T3-14).
 */
function isStorableMetadataValue(value: unknown): boolean {
  if (typeof value === 'string') return value.isWellFormed();
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  let strings = 0;
  let numbers = 0;
  for (let index = 0; index < value.length; index++) {
    const item: unknown = value[index];
    if (isWellFormedString(item)) strings += 1;
    else if (typeof item === 'number' && Number.isFinite(item)) numbers += 1;
    else return false;
  }
  return strings === 0 || numbers === 0;
}

/**
 * A document a harness store can write: a well-formed string `pageContent`
 * (it is stored under the page-content key), and metadata that is absent, or an
 * object of storable values under well-formed keys that does not use the
 * page-content key itself.
 */
export function isWritableDocument(value: unknown): boolean {
  if (!isRecord(value) || !isWellFormedString(value['pageContent'])) return false;
  const metadata: unknown = value['metadata'];
  if (isAbsent(metadata)) return true;
  if (!isRecord(metadata) || Object.hasOwn(metadata, PAGE_CONTENT_KEY)) return false;
  return Object.entries(metadata).every(
    ([key, item]) => key.isWellFormed() && isStorableMetadataValue(item),
  );
}

/**
 * One embedding a cosine harness store can write: 1–4096 finite components, no
 * holes, and not the zero vector (docs/evidence/zero-vector.md).
 */
export function isWritableVector(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length < MIN_DIMENSION || value.length > MAX_DIMENSION) return false;
  let sumOfSquares = 0;
  for (let index = 0; index < value.length; index++) {
    const component: unknown = value[index];
    if (typeof component !== 'number' || !Number.isFinite(component)) return false;
    sumOfSquares += component * component;
  }
  return sumOfSquares !== 0;
}

/**
 * The options bag a write takes, for `count` documents: absent, or an object
 * whose `ids` — when present — are `count` unique vector keys, whose `batchSize`
 * — when present — is an integer 1–500, and whose `signal` is an optional signal.
 */
export function isWriteOptions(options: unknown, count: number): boolean {
  if (isAbsent(options)) return true;
  if (!isRecord(options)) return false;
  const ids: unknown = options['ids'];
  if (!isAbsent(ids) && !(isUniqueKeyList(ids) && (ids as unknown[]).length === count)) {
    return false;
  }
  return (
    isOptionalIntegerUpTo(options['batchSize'], MAX_PUT_BATCH_SIZE) &&
    isOptionalSignal(options['signal'])
  );
}
