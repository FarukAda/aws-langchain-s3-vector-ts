/**
 * Hides where a vector's id comes from and what may be one.
 *
 * A caller may supply ids, or let them be derived from the documents, or let
 * them be minted; the bounds the service enforces are the same either way. Both
 * halves are decisions a caller should not have to restate, and the copy taken
 * here is what makes every later check mean anything.
 */
import { randomUUID } from 'node:crypto';

import type { DocumentInterface } from '@langchain/core/documents';

import { describeRecord } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { OperationScope } from '../shared/scope.js';
import { unpairedSurrogateReason } from '../shared/utf16.js';

/**
 * A vector id is 1–1024 characters
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutInputVector.html).
 * GetVectors and DeleteVectors ids carry the same bounds
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectors.html,
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectors.html).
 *
 * The service spells this identifier `key`, and the AWS documentation linked
 * above does too. This package spells it `id` — the word `@langchain/core` and
 * this package's own surface use (`getByIds`, `writtenIds`, `recordId`) — and
 * translates to `key` only where a command is built or a response read. The
 * two words are one concept, and every name between here and the wire says
 * `id` so that `key` always means a metadata key instead.
 */
const ID_MIN_LENGTH = 1;
const ID_MAX_LENGTH = 1024;

/** Options for {@link assertIdsWellFormed} and {@link assertIdsUnique}. */
export interface IdCheckOptions extends OperationScope {
  /**
   * Where the ids came from, as a message should name it — `'options.ids'`,
   * `'params.ids'`, `'the ids argument'`, or the documents' own ids. It decides
   * who has to fix a bad id: the caller's own list, or the documents they passed.
   */
  readonly source: string;
}

/**
 * The ids a write will use.
 *
 * Accepts:
 * - `documents` — read only for `id`.
 * - `ids` — a caller's array, copied; its length is checked by the caller
 *   against the vectors or documents it accompanies. `undefined` derives one
 *   id per document.
 *
 * Returns: **a fresh array, never the caller's own**. When deriving, each
 * document's own `id`, or a fresh UUID where that is `undefined` or `null`. An
 * empty-string id is returned unchanged, for {@link assertIdsWellFormed} to
 * reject — it is caller data gone wrong (an empty column, an unset ORM field),
 * and minting an unrelated id for it would hide that.
 *
 * Throws: nothing.
 *
 * Guarantees: the copy is what makes the validation that follows mean anything.
 * Ids are checked once, up front, and then read again per batch as each one is
 * dispatched; against the caller's own array those two moments can disagree,
 * because a caller is free to mutate an array it still holds while the promise
 * is pending. Reusing one buffer across batches, or handing the same array to
 * two concurrent writes, is enough — and what gets written then is ids nothing
 * validated: duplicates, which S3 Vectors resolves by silently overwriting the
 * earlier vector, or `undefined`.
 *
 * It is also the list the caller must attach to a failure so a retry can reuse
 * it and overwrite in place rather than duplicate under fresh UUIDs, and the
 * list handed back on success — both of which have to be this package's own, or
 * the record of what was written can be rewritten after the fact.
 */
export function resolveWriteIds(
  documents: readonly DocumentInterface[],
  ids: string[] | undefined,
): string[] {
  return ids === undefined
    ? documents.map((doc) => doc.id ?? randomUUID().replace(/-/g, ''))
    : [...ids];
}

/**
 * Why S3 Vectors cannot take this value as a vector id, or `undefined` if it can.
 *
 * Accepts: anything.
 *
 * Returns: a clause for the first rule broken — not a string, empty, over 1024
 * characters, or not well-formed UTF-16 (docs/evidence/string-encoding.md, T3-15).
 *
 * Throws: nothing.
 */
function idRejectionReason(id: unknown): string | undefined {
  if (typeof id !== 'string') return `is not a string (received ${typeof id})`;
  if (id.length < ID_MIN_LENGTH) {
    return 'is an empty string, but every id must be a non-empty string';
  }
  if (id.length > ID_MAX_LENGTH) {
    return `is ${id.length} characters, over the ${ID_MAX_LENGTH}-character maximum for a vector id`;
  }
  return unpairedSurrogateReason(id);
}

/**
 * Raise the `VALIDATION` for the id at `index`.
 *
 * Accepts: the list, the failing position, the reason, and the check's options.
 *
 * Returns: never.
 *
 * Throws: {@link S3VectorsError} `VALIDATION`, naming the position and the
 * source, carrying `recordIndex` and — when the id is a string — `recordId`.
 */
function failId(
  ids: readonly unknown[],
  index: number,
  reason: string,
  opts: IdCheckOptions,
): never {
  const { source, ...scope } = opts;
  const id: unknown = ids[index];
  throw new S3VectorsError(
    `${describeRecord('Vector id', { recordIndex: index })} ${reason}. Ids were taken from ${source}.`,
    S3VectorsErrorCode.VALIDATION,
    { ...scope, recordIndex: index, ...(typeof id === 'string' ? { recordId: id } : {}) },
  );
}

/**
 * Reject a list holding a value S3 Vectors cannot take as a vector id.
 *
 * Accepts: `ids` — any list; `opts.source` — where the ids came from.
 *
 * Returns: nothing. A repeated id is not examined here; see
 * {@link assertIdsUnique}.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` for the first element
 * that is not a string, is empty, is over 1024 characters or contains an
 * unpaired surrogate — carrying `recordIndex` and, for a string, `recordId`.
 *
 * Guarantees: every element is checked, holes included; a hole reads as
 * `undefined`, which is not a string.
 */
export function assertIdsWellFormed(ids: readonly unknown[], opts: IdCheckOptions): void {
  for (let index = 0; index < ids.length; index++) {
    const reason = idRejectionReason(ids[index]);
    if (reason !== undefined) failId(ids, index, reason, opts);
  }
}

/**
 * Reject a write's or a delete's ids for repeating one within the call.
 *
 * Accepts: `ids` — the resolved list; `opts.source` — where the ids came from.
 * Shape is not re-examined here; a caller runs {@link assertIdsWellFormed}
 * first, and both checks are stated separately because they answer separate
 * questions — whether the service can store this id at all, and whether this
 * particular call asks for it twice.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` for the second
 * occurrence of a repeated id, naming the first.
 *
 * Guarantees: a duplicate matters differently on each path, and is refused on
 * both. `PutVectors` accepts it and lets the later vector silently overwrite the
 * earlier, so a caller would get back a full-length id list having lost a
 * document. `DeleteVectors` refuses the request outright — "Request must not
 * contain duplicate keys", probed against the live service — so forwarding it
 * only buys a round trip. Duplicates *across* calls are an upsert and are
 * untouched.
 */
export function assertIdsUnique(ids: readonly unknown[], opts: IdCheckOptions): void {
  const firstSeen = new Map<unknown, number>();
  for (let index = 0; index < ids.length; index++) {
    const earlier = firstSeen.get(ids[index]);
    if (earlier !== undefined) {
      failId(
        ids,
        index,
        `repeats the id at index ${earlier} — a duplicate, and each id may appear only once per ` +
          'call. On a write S3 Vectors takes both and the later vector silently overwrites the ' +
          'earlier, so the returned id list would be full length having lost a document; on a ' +
          'delete it refuses the request outright ("Request must not contain duplicate keys"). ' +
          'To overwrite an existing vector, write it in a separate call',
        opts,
      );
    }
    firstSeen.set(ids[index], index);
  }
}
