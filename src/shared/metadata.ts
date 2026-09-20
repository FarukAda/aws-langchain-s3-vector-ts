import { Document, type DocumentInterface } from '@langchain/core/documents';

import type { S3OutputVector } from '../types.js';
import { describeRecord, type RecordRef } from './describe.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';
import type { OperationScope } from './scope.js';
import { unpairedSurrogateReason } from './utf16.js';

/** The store configuration a write of metadata is built against. */
export interface MetadataConfig {
  /** Where page content is stored, or `null` to store none. */
  readonly pageContentMetadataKey: string | null;
  /** The index's non-filterable keys, already merged with the page-content key. */
  readonly nonFilterableMetadataKeys: readonly string[];
}

/** Options for {@link buildPutMetadata}. */
export interface PutMetadataOptions extends MetadataConfig, OperationScope {
  /** The document's place in the caller's input, named in every refusal. */
  readonly record: RecordRef;
}

/**
 * AWS metadata limits. The byte ceilings carry a measured 5-byte overhead on
 * top of the JSON serialisation — see docs/evidence/metadata-limits.md, where
 * the gap was measured independently at both scales.
 */
const MAX_METADATA_KEYS = 50;
const FILTERABLE_BYTE_LIMIT = 2048;
const TOTAL_BYTE_LIMIT = 40960;
const MEASURED_OVERHEAD_BYTES = 5;

/**
 * Why S3 Vectors could not store this value, or `undefined` if it can.
 *
 * Accepted values are per docs/evidence/metadata-value-types.md (T3-9, T3-14):
 * a string, a boolean, a number, or a non-empty array of only strings or only
 * numbers. A string must also be well-formed UTF-16, because S3 Vectors fails
 * the whole request carrying one that is not (docs/evidence/string-encoding.md,
 * T3-15).
 *
 * One rule sits on top of what the service enforces: a value is refused unless
 * its `JSON.stringify` form is also its wire form. The SDK's document serialiser
 * does not agree with `JSON.stringify` everywhere, and where they disagree the
 * stored data is not what the caller passed:
 *
 * - a non-finite number is written as the *string* `"NaN"` / `"Infinity"`
 *   (`@aws-sdk/core` `submodules/protocols`), so the stored type changes and a
 *   numeric filter on that field never matches again, while `JSON.stringify`
 *   renders it `null`;
 * - a hole in an array is omitted rather than sent as `null`, so the array
 *   comes back shorter and every later element has shifted position.
 *
 * Refusing those is what makes {@link serialisedBytes} honest, without this
 * package carrying a second copy of the SDK's serialiser to measure against.
 */
function rejectionReason(value: unknown): string | undefined {
  if (typeof value === 'string') return unpairedSurrogateReason(value);
  if (typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? undefined
      : `is ${String(value)}, which is not a finite number. The AWS SDK serialises it as ` +
          `the string "${String(value)}", so it would be stored as text and no numeric ` +
          'filter would ever match it';
  }
  if (Array.isArray(value)) return arrayRejectionReason(value);
  return (
    'has a value S3 Vectors does not accept. Values must be a string, number, boolean, ' +
    'or a non-empty array of only strings or only numbers'
  );
}

/**
 * Why an array cannot be stored, or `undefined` if it can.
 *
 * Checked in this order: an empty array; then each element — a hole, a string
 * that is not well-formed, a non-finite number, anything that is neither a
 * string nor a number; and last, strings mixed with numbers. S3 Vectors refuses
 * an empty array and a mixed one (docs/evidence/metadata-value-types.md, T3-14).
 *
 * Indexed rather than `Array.prototype.every`, which **skips holes**: `[1, , 3]`
 * satisfied a callback checking that every element was a number, because the
 * missing one was never visited.
 */
function arrayRejectionReason(value: readonly unknown[]): string | undefined {
  if (value.length === 0) {
    return (
      'is an empty array, which S3 Vectors rejects ("Empty arrays are not allowed in ' +
      'metadata"). Omit the key instead'
    );
  }
  let firstString: number | undefined;
  let firstNumber: number | undefined;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      return (
        `has a hole at index ${index}. The AWS SDK omits a missing element rather than ` +
        'sending null for it, so the array would be stored shorter than it is and every ' +
        'later element would shift position'
      );
    }
    const item: unknown = value[index];
    if (typeof item === 'string') {
      const reason = unpairedSurrogateReason(item);
      if (reason !== undefined) return `has a string at index ${index} that ${reason}`;
      firstString ??= index;
      continue;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        return (
          `has ${String(item)} at index ${index}, which is not a finite number. The AWS SDK ` +
          'serialises it as a string, changing the stored type of that element'
        );
      }
      firstNumber ??= index;
      continue;
    }
    return (
      `has a value of type ${typeof item} at index ${index}; an array may hold only strings ` +
      'and numbers'
    );
  }
  if (firstString !== undefined && firstNumber !== undefined) {
    return (
      `mixes strings and numbers (a string at index ${firstString}, a number at index ` +
      `${firstNumber}). S3 Vectors rejects that ("Metadata array values must be strings or ` +
      'numbers"): every element of a metadata array must be the same type'
    );
  }
  return undefined;
}

/**
 * Set an own, enumerable property, whatever the key is called.
 *
 * `defineProperty`, not assignment: assigning to `__proto__` on a plain object
 * runs the inherited setter and stores nothing at all, which once silently
 * discarded every document's page content.
 */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * UTF-8 bytes of the JSON serialisation, which is what AWS counts.
 *
 * Truthful only because {@link rejectionReason} has already refused every value
 * whose JSON form differs from what the SDK sends. Before that rule the count
 * was wrong in both directions — 97 counted against 106 sent for one payload,
 * 117 against 114 for another.
 */
function serialisedBytes(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') + MEASURED_OVERHEAD_BYTES;
}

/**
 * Which keys the filterable budget left out, for the rejection message.
 *
 * A byte count alone cannot be acted on: the caller has to know which keys were
 * counted, and that the index — not this store — is what AWS measures against.
 */
function describeBudgetedMetadataKeys(nonFilterableMetadataKeys: readonly string[]): string {
  return nonFilterableMetadataKeys.length === 0
    ? 'This store declares no non-filterable keys, so every metadata key counts toward it.'
    : `This store treats [${[...nonFilterableMetadataKeys]
        .map((key) => JSON.stringify(key))
        .join(', ')}] as non-filterable, so every other key counts toward it.`;
}

/**
 * Build the metadata object to send alongside a `PutVectors` call.
 *
 * Accepts:
 * - `doc` — its `metadata` is copied and its `pageContent` stored under
 *   `pageContentMetadataKey` when that is not `null`.
 * - `opts.nonFilterableMetadataKeys` — the index's non-filterable keys, already merged
 *   with the page-content key. Keys named here are exempt from the filterable
 *   budget and still count toward the total.
 * - `opts.record` — the document's position in the caller's input, and its id.
 *
 * Returns: the metadata to send — a new object whose array values are copies, so
 * nothing the caller still holds can change it once it has been validated — and
 * `metadataBytes`, the count this function already measured it at to apply the
 * per-vector ceiling. The write path budgets `PutVectors` request sizes with
 * that number rather than serialising the metadata a second time to find it
 * (see `internal/request-size.ts`).
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` — its message led by the
 * record (`Document at index 400 (id "ticket-400"): …`) and its context carrying
 * `recordIndex` and `recordId` — when the document's own metadata already uses
 * the reserved key; when a key or a string value is not well-formed UTF-16; when
 * a value is not a string, finite number, boolean, or non-empty array of only
 * strings or only finite numbers; when the key count exceeds 50 including the key
 * this package adds; or when either byte ceiling is exceeded.
 *
 * Guarantees: every rule is one S3 Vectors enforces, measured against the live
 * service rather than inferred from documentation (docs/evidence/), or the
 * wire-form rule above. It depends on nothing but its arguments, so a caller can
 * apply it to the whole of a write before spending anything.
 */
export function buildPutMetadata(
  doc: DocumentInterface,
  opts: PutMetadataOptions,
): { metadata: Record<string, unknown>; metadataBytes: number } {
  const { pageContentMetadataKey, nonFilterableMetadataKeys, operation, record } = opts;
  const scope = { vectorBucketName: opts.vectorBucketName, indexName: opts.indexName };
  const subject = describeRecord('Document', record);
  const fail = (message: string): never => {
    throw new S3VectorsError(`${subject}: ${message}`, S3VectorsErrorCode.VALIDATION, {
      operation,
      ...scope,
      ...record,
    });
  };

  const metadata: Record<string, unknown> = { ...doc.metadata };

  if (pageContentMetadataKey !== null) {
    if (Object.hasOwn(metadata, pageContentMetadataKey)) {
      fail(
        `Its metadata already contains reserved key '${pageContentMetadataKey}' ` +
          '(used internally to store pageContent). Rename this metadata field or configure ' +
          'a different `pageContentMetadataKey`.',
      );
    }
    defineOwn(metadata, pageContentMetadataKey, doc.pageContent);
  }

  for (const [key, value] of Object.entries(metadata)) {
    const keyReason = unpairedSurrogateReason(key);
    if (keyReason !== undefined) fail(`Metadata key ${JSON.stringify(key)} ${keyReason}.`);
    const reason = rejectionReason(value);
    if (reason !== undefined) fail(`Metadata key '${key}' ${reason}.`);
    // Copied once known to be storable: the record owns everything that was
    // validated, and the caller keeps their own array to do with as they like.
    if (Array.isArray(value)) defineOwn(metadata, key, [...(value as unknown[])]);
  }

  const keyCount = Object.keys(metadata).length;
  if (keyCount > MAX_METADATA_KEYS) {
    fail(
      `A vector may have at most ${MAX_METADATA_KEYS} metadata keys; this document needs ` +
        `${keyCount}${pageContentMetadataKey === null ? '' : ', including the page-content key this package adds'}.`,
    );
  }

  const nonFilterable = new Set(nonFilterableMetadataKeys);
  const filterable = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !nonFilterable.has(key)),
  );
  const filterableBytes = serialisedBytes(filterable);
  if (filterableBytes > FILTERABLE_BYTE_LIMIT) {
    fail(
      `Filterable metadata is ${filterableBytes} bytes, over the ${FILTERABLE_BYTE_LIMIT}-byte ` +
        `limit. ${describeBudgetedMetadataKeys(nonFilterableMetadataKeys)} If the index declares a different ` +
        "set, the index's set is the one AWS measures against and this rejection is local " +
        'only: align `nonFilterableMetadataKeys` and `pageContentMetadataKey` with the index. ' +
        'Otherwise, declare large fields as non-filterable metadata keys on the index — a ' +
        'non-filterable key set is fixed when the index is created, so that means a new index.',
    );
  }

  const totalBytes = serialisedBytes(metadata);
  if (totalBytes > TOTAL_BYTE_LIMIT) {
    fail(`Metadata is ${totalBytes} bytes, over the ${TOTAL_BYTE_LIMIT}-byte limit per vector.`);
  }

  return { metadata, metadataBytes: totalBytes };
}

/**
 * Reconstruct a LangChain `Document` from an S3 vector response.
 *
 * Accepts:
 * - `vector` — the raw S3 output vector.
 * - `pageContentMetadataKey` — the key page content was stored under, or
 *   `null` if it is not round-tripped.
 * - `scope` — the public method the caller invoked, plus the bucket and
 *   index, named in the error this raises.
 *
 * Returns: a `Document` that owns its metadata outright, nested values
 * included.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION`, naming `scope.operation`
 * and carrying `scope.vectorBucketName`/`scope.indexName`, if the metadata holds
 * a value `structuredClone` cannot copy — a function or symbol, reachable only
 * from a custom or mocked client, since AWS returns JSON.
 *
 * Guarantees: every returned document owns its metadata. One rule, no aliasing
 * between documents ever — two results built from the same response share
 * nothing, so mutating one cannot alter another.
 */
export function createDocument(
  vector: S3OutputVector,
  pageContentMetadataKey: string | null,
  scope: OperationScope,
): Document {
  let pageContent = '';
  const rawMeta = vector.metadata ?? {};
  let metadata: Record<string, unknown>;

  try {
    metadata = structuredClone(rawMeta);
  } catch (cause) {
    throw new S3VectorsError(
      `Failed to copy metadata for vector '${vector.key}': it contains a value that cannot be ` +
        'structured-cloned (e.g. a function or symbol). Ensure vector metadata contains only ' +
        'structured-cloneable values.',
      S3VectorsErrorCode.VALIDATION,
      { ...scope },
      cause,
    );
  }

  if (pageContentMetadataKey !== null && Object.hasOwn(metadata, pageContentMetadataKey)) {
    const rawValue = metadata[pageContentMetadataKey];
    if (typeof rawValue === 'string') {
      pageContent = rawValue;
      delete metadata[pageContentMetadataKey];
    }
    // A non-string value under this key was never written by this library —
    // buildPutMetadata always stores a string — so it belongs to whatever else
    // shares the index. It is left in place rather than silently deleted.
  }

  const doc = new Document({ pageContent, metadata });
  doc.id = vector.key;
  return doc;
}
