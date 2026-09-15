import { Document, type DocumentInterface } from '@langchain/core/documents';

import type { S3OutputVector } from '../types.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

/** Options for {@link buildPutMetadata}. */
export interface PutMetadataOptions {
  /** Where page content is stored, or `null` to store none at all. */
  readonly pageContentMetadataKey: string | null;
  /** The index's non-filterable keys, already merged with the page-content key. */
  readonly nonFilterableKeys: readonly string[];
  /** The public method this write belongs to; named in the error it raises. */
  readonly operation: string;
  /** The bucket, for the error's context. */
  readonly vectorBucketName: string;
  /** The index, for the error's context. */
  readonly indexName: string;
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
 * Accepted values are per docs/evidence/metadata-value-types.md, with one rule
 * on top: a value is refused unless its `JSON.stringify` form is also its wire
 * form. The SDK's document serialiser does not agree with `JSON.stringify`
 * everywhere, and where they disagree the stored data is not what the caller
 * passed:
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
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return undefined;
  if (type === 'number') {
    return Number.isFinite(value)
      ? undefined
      : `is ${String(value)}, which is not a finite number. The AWS SDK serialises it as ` +
          `the string "${String(value)}", so it would be stored as text and no numeric ` +
          'filter would ever match it';
  }
  if (Array.isArray(value)) return arrayRejectionReason(value);
  return (
    'has a value S3 Vectors does not accept. Values must be a ' +
    'string, number, boolean, or an array of strings or numbers'
  );
}

/**
 * Why an array cannot be stored, or `undefined` if it can.
 *
 * Indexed rather than `Array.prototype.every`, which **skips holes**: `[1, , 3]`
 * satisfied a callback checking that every element was a number, because the
 * missing one was never visited.
 */
function arrayRejectionReason(value: readonly unknown[]): string | undefined {
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      return (
        `has a hole at index ${index}. The AWS SDK omits a missing element rather than ` +
        'sending null for it, so the array would be stored shorter than it is and every ' +
        'later element would shift position'
      );
    }
    const item: unknown = value[index];
    if (typeof item === 'string') continue;
    if (typeof item === 'number') {
      if (Number.isFinite(item)) continue;
      return (
        `has ${String(item)} at index ${index}, which is not a finite number. The AWS SDK ` +
        'serialises it as a string, changing the stored type of that element'
      );
    }
    return (
      `has a value of type ${typeof item} at index ${index}; an array may hold only strings ` +
      'and numbers'
    );
  }
  return undefined;
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
 * Build the metadata object to send alongside a `PutVectors` call.
 *
 * Accepts:
 * - `doc` — its `metadata` is copied and its `pageContent` stored under
 *   `pageContentMetadataKey` when that is not `null`.
 * - `opts.nonFilterableKeys` — the index's non-filterable keys, already merged
 *   with the page-content key. Keys named here are exempt from the filterable
 *   budget and still count toward the total.
 *
 * Returns: the metadata to send.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` when the document's own
 * metadata already uses the reserved key, when a value is not a string, number,
 * boolean or array of strings/numbers, when the key count exceeds 50 including
 * the key this package adds, or when either byte ceiling is exceeded.
 *
 * Guarantees: every rule is checked locally, before the embedding spend that
 * would otherwise precede an AWS rejection. Each was measured against the live
 * service rather than inferred from documentation (docs/evidence/).
 */
export function buildPutMetadata(
  doc: DocumentInterface,
  opts: PutMetadataOptions,
): Record<string, unknown> {
  const { pageContentMetadataKey, nonFilterableKeys, operation } = opts;
  const scope = { vectorBucketName: opts.vectorBucketName, indexName: opts.indexName };
  const fail = (message: string): never => {
    throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation, ...scope });
  };

  const metadata: Record<string, unknown> = { ...doc.metadata };

  if (pageContentMetadataKey !== null) {
    if (Object.hasOwn(metadata, pageContentMetadataKey)) {
      fail(
        `Document metadata already contains reserved key '${pageContentMetadataKey}' ` +
          '(used internally to store pageContent). Rename this metadata field or configure ' +
          'a different `pageContentMetadataKey`.',
      );
    }
    // `defineProperty`, not assignment: assigning to `__proto__` on a plain
    // object runs the inherited setter and stores nothing at all, so every
    // document's page content was silently discarded and read back as `''`.
    // The config validator refuses that key outright now; this keeps the
    // function correct regardless of who calls it, and costs one line.
    Object.defineProperty(metadata, pageContentMetadataKey, {
      value: doc.pageContent,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  for (const [key, value] of Object.entries(metadata)) {
    const reason = rejectionReason(value);
    if (reason !== undefined) {
      fail(`Metadata key '${key}' ${reason}.`);
    }
  }

  const keyCount = Object.keys(metadata).length;
  if (keyCount > MAX_METADATA_KEYS) {
    fail(
      `A vector may have at most ${MAX_METADATA_KEYS} metadata keys; this document needs ` +
        `${keyCount}${pageContentMetadataKey === null ? '' : ', including the page-content key this package adds'}.`,
    );
  }

  const nonFilterable = new Set(nonFilterableKeys);
  const filterable = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !nonFilterable.has(key)),
  );
  const filterableBytes = serialisedBytes(filterable);
  if (filterableBytes > FILTERABLE_BYTE_LIMIT) {
    fail(
      `Filterable metadata is ${filterableBytes} bytes, over the ${FILTERABLE_BYTE_LIMIT}-byte ` +
        'limit. Declare large fields as non-filterable metadata keys on the index.',
    );
  }

  const totalBytes = serialisedBytes(metadata);
  if (totalBytes > TOTAL_BYTE_LIMIT) {
    fail(`Metadata is ${totalBytes} bytes, over the ${TOTAL_BYTE_LIMIT}-byte limit per vector.`);
  }

  return metadata;
}

/**
 * Reconstruct a LangChain `Document` from an S3 vector response.
 *
 * Accepts:
 * - `vector` — the raw S3 output vector.
 * - `pageContentMetadataKey` — the key page content was stored under, or
 *   `null` if it is not round-tripped.
 *
 * Returns: a `Document` that owns its metadata outright, nested values
 * included.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` if the metadata holds a
 * value `structuredClone` cannot copy — a function or symbol, reachable only
 * from a custom or mocked client, since AWS returns JSON.
 *
 * Guarantees: every returned document owns its metadata. One rule, no aliasing
 * between documents ever — two results built from the same response share
 * nothing, so mutating one cannot alter another.
 */
export function createDocument(
  vector: S3OutputVector,
  pageContentMetadataKey: string | null,
  operation = 'createDocument',
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
      { operation },
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
