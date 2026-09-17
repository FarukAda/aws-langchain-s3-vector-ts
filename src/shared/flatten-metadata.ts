import { describeValue } from './describe.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';
import { isPlainObject } from './objects.js';

/** Between a nested object's key and its own, as `loc.lines.from`. */
const SEPARATOR = '.';

/** Raise the `VALIDATION` this helper refuses with, naming `flattenMetadata`. */
function fail(message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
    operation: 'flattenMetadata',
  });
}

/**
 * Flatten nested document metadata into the shape S3 Vectors stores.
 *
 * Accepts: a document's `metadata`, however deeply nested.
 *
 * Returns: a new object whose nested plain objects have become dotted keys —
 * `{ loc: { lines: { from: 1 } } }` becomes `{ 'loc.lines.from': 1 }` — with
 * `null`, `undefined`, empty arrays and empty objects dropped, and every other
 * value passed through untouched. The caller's object and everything inside it
 * are left alone.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` when two fields would
 * flatten onto the same key, when the metadata contains a circular reference,
 * or when it is not an object at all.
 *
 * Guarantees, and the reasons for them:
 * - **Nothing is converted.** A value this cannot flatten — a `Date`, a mixed
 *   array, a non-finite number — is passed through as it is, so the write path
 *   refuses it naming the document and the key rather than this quietly storing
 *   something the caller did not choose.
 * - **Only the empty is dropped.** `null`, `undefined`, `[]` and `{}` are what
 *   a loader emits for a field it has no value for, and S3 Vectors stores none
 *   of them; every one of those four is refused by the service, measured under
 *   a filterable *and* a non-filterable key
 *   (`docs/evidence/metadata-value-types.md`). Dropping them is what makes an
 *   ordinary loader document writable; anything else would be losing data.
 * - **A collision is refused, not resolved.** `{ 'loc.pageNumber': 1, loc: {
 *   pageNumber: 2 } }` has one answer at AWS and two here; picking one silently
 *   is how a document gets stored with a field nobody wrote.
 *
 * Why this is a function you call rather than a store option: what a store
 * writes is what you passed it, and a flag that rewrote every document's keys
 * on the way to AWS would make that untrue for every write it touched. Here the
 * rewriting is visible at the call site.
 *
 * @example
 * ```ts
 * import { flattenMetadata } from "@farukada/aws-langchain-s3-vector-ts";
 *
 * const chunks = await splitter.splitDocuments(docs);
 * await store.addDocuments(
 *   chunks.map((doc) => new Document({ ...doc, metadata: flattenMetadata(doc.metadata) })),
 * );
 * ```
 */
export function flattenMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    fail(
      `flattenMetadata takes a document's metadata object (received ${describeValue(metadata)}).`,
    );
  }
  const flat: Record<string, unknown> = {};
  const ancestors = new Set<unknown>();

  const walk = (source: Record<string, unknown>, prefix: string): void => {
    ancestors.add(source);
    for (const [key, value] of Object.entries(source)) {
      const path = prefix === '' ? key : `${prefix}${SEPARATOR}${key}`;
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (isPlainObject(value)) {
        if (ancestors.has(value)) {
          fail(
            `flattenMetadata found a circular reference at '${path}'. Metadata is stored as ` +
              'JSON, which cannot represent one.',
          );
        }
        walk(value, path);
        continue;
      }
      if (Object.hasOwn(flat, path)) {
        fail(
          `flattenMetadata would write two different fields to '${path}'. Rename one of them: ` +
            'a flattened key and a key that already contains the separator are the same key to ' +
            'S3 Vectors.',
        );
      }
      flat[path] = Array.isArray(value) ? [...(value as unknown[])] : value;
    }
    ancestors.delete(source);
  };

  walk(metadata, '');
  return flat;
}
