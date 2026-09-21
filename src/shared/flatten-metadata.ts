/**
 * Hides that filterable metadata has to be flat.
 *
 * S3 Vectors filters on top-level metadata keys only, so a nested object is
 * unfilterable in practice. This turns one into dotted keys that can be filtered,
 * which is a transformation a caller has to opt into: it changes the key names
 * their filters must use, and that is a decision only they can make.
 */
import { describeValue } from './describe.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';
import { wrapCallerError } from './errors/wrap-error.js';
import { defineOwn, isPlainObject } from './objects.js';

/** Between a nested object's key and its own, as `loc.lines.from`. */
const SEPARATOR = '.';

/**
 * How deep this will walk before refusing.
 *
 * The walk is recursive, so without a bound a deeply nested object exhausts the
 * stack and escapes as a raw `RangeError` — uncoded, so `isS3VectorsError`
 * returns `false` for it and a caller's `catch` falls through to its generic
 * handler. The threshold is around four thousand levels, and `JSON.parse` is
 * iterative, so plain user JSON reaches it.
 *
 * 32 is far beyond anything a loader produces — the deepest real case in the
 * wild is `pdf.info.Title` at three — and far below where recursion is a
 * problem.
 */
const MAX_DEPTH = 32;

/**
 * How many objects this will enter before refusing.
 *
 * {@link flattenMetadata} tracks ancestors along the current *path*, which is
 * what makes it able to spot a cycle. It also means a value reached twice by
 * different paths is walked twice, so a graph that shares references expands as
 * if it were a tree: 22 levels of `{ a: n, b: n }` over one shared child is
 * about 8.4 million nodes and 4.2 million output keys, which took 7 seconds and
 * 862 MB in a measurement, on input of a few hundred bytes.
 *
 * Refusing a repeat outright would be wrong — `{ a: shared, b: shared }` is
 * legitimate and small — so the bound is on total work instead. Any real
 * metadata object is a few dozen nodes.
 */
const MAX_NODES = 100_000;

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
 * when it is nested or aliased past what this can walk, or when it is not an
 * object at all; and with code `UNEXPECTED_ERROR`, carrying what was thrown as
 * the `cause`, when reading the caller's own object throws — an accessor on it
 * is the caller's code, and it runs here. Nothing else leaves this function:
 * every failure is one of this package's errors, as it is from every method on
 * the store.
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
  try {
    return flatten(metadata);
  } catch (error: unknown) {
    // Reading the caller's object — the shape check's `getPrototypeOf`, and
    // `Object.entries` on every level below it — runs whatever accessors are
    // behind it, and an accessor is the caller's code: a lazily loaded ORM field
    // whose session has closed, a revoked `Proxy`. Every other entry point in
    // this package reports that as `UNEXPECTED_ERROR`; this one, the only
    // published function that is not a method on the store, let it out exactly
    // as it was thrown — uncoded, so `isS3VectorsError` said `false` about a
    // failure raised inside this package, on the one path whose whole job is to
    // refuse bad metadata by name.
    //
    // `wrapCallerError` returns an error that is already ours unchanged, so the
    // three `VALIDATION` refusals below pass through naming this function.
    throw wrapCallerError(error, { operation: 'flattenMetadata' });
  }
}

/**
 * {@link flattenMetadata} itself, with nothing said about how a failure is
 * reported.
 *
 * Accepts, returns and throws exactly what {@link flattenMetadata} documents,
 * except that a read of the caller's object leaves it as whatever it threw. It
 * is separate so the coding sits in one `try` around the whole walk rather than
 * around each read — the reads are one per level, and a rule restated at each
 * of them is a rule one of them will not have.
 */
function flatten(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    fail(
      `flattenMetadata takes a document's metadata object (received ${describeValue(metadata)}).`,
    );
  }
  const flat: Record<string, unknown> = {};
  const ancestors = new Set<unknown>();
  let nodes = 0;

  const walk = (source: Record<string, unknown>, prefix: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      fail(
        `flattenMetadata found metadata nested more than ${MAX_DEPTH} levels deep at ` +
          `'${prefix}'. S3 Vectors stores no nested object at all, so a document this deep is ` +
          'not one it could hold flattened either.',
      );
    }
    nodes += 1;
    if (nodes > MAX_NODES) {
      fail(
        `flattenMetadata gave up after entering ${MAX_NODES} objects, at '${prefix}'. Metadata ` +
          'that shares one object between many fields expands as though each were its own copy, ' +
          'so a small input can flatten to millions of keys.',
      );
    }
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
        walk(value, path, depth + 1);
        continue;
      }
      if (Object.hasOwn(flat, path)) {
        fail(
          `flattenMetadata would write two different fields to '${path}'. Rename one of them: ` +
            'a flattened key and a key that already contains the separator are the same key to ' +
            'S3 Vectors.',
        );
      }
      // defineOwn, not assignment: `flat['__proto__'] = value` writes no
      // property, drops the field, and for an object value replaces this
      // object's prototype with the caller's data.
      defineOwn(flat, path, Array.isArray(value) ? [...(value as unknown[])] : value);
    }
    ancestors.delete(source);
  };

  walk(metadata, '', 0);
  return flat;
}
