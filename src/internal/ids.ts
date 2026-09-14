import { randomUUID } from 'node:crypto';

import type { DocumentInterface } from '@langchain/core/documents';

import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { StoreScope } from './signals.js';

/**
 * A vector key is 1–1024 characters
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutInputVector.html).
 */
const KEY_MIN_LENGTH = 1;
const KEY_MAX_LENGTH = 1024;

/**
 * The ids a write will use.
 *
 * Accepts:
 * - `documents` — read only for `id`.
 * - `ids` — any array is returned verbatim, its length checked by the caller
 *   against the vectors or documents it accompanies. `undefined` derives one
 *   id per document.
 *
 * Returns: when deriving, each document's own `id`, or a fresh UUID where that
 * is `undefined` or `null`. An empty-string id is returned unchanged, for
 * {@link assertIdsWellFormed} to reject — it is caller data gone wrong (an
 * empty column, an unset ORM field), and minting an unrelated key for it would
 * hide that.
 *
 * Throws: nothing.
 *
 * Guarantees: pure, and the list the caller must attach to a failure so a retry
 * can reuse it and overwrite in place rather than duplicate under fresh UUIDs.
 */
export function resolveWriteIds(
  documents: readonly DocumentInterface[],
  ids: string[] | undefined,
): string[] {
  return ids ?? documents.map((doc) => doc.id ?? randomUUID().replace(/-/g, ''));
}

/**
 * Reject a write whose ids are not unique, non-empty strings within length.
 *
 * Accepts:
 * - `ids` — the resolved list.
 * - `idsSupplied` — names the source in the message: the caller's
 *   `options.ids`, or the documents' own `id` fields.
 *
 * Returns: nothing.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION`, naming the offending
 * index, for a non-string, an empty string, an id over 1024 characters, or a
 * duplicate within this call. A duplicate matters because AWS accepts it and
 * the later vector silently overwrites the earlier one, so the caller would get
 * back a full-length id list having lost a document. Duplicates *across* calls
 * are an upsert and are untouched.
 */
export function assertIdsWellFormed(
  ids: string[],
  operation: string,
  scope: StoreScope,
  idsSupplied: boolean,
): void {
  const source = idsSupplied
    ? 'options.ids'
    : "the documents' own `id` fields (a UUID is generated only for a document with no id at all)";
  // Explicitly typed so TypeScript treats a call as never-returning and
  // narrows `id` below; an inferred arrow does not drive control-flow analysis.
  const fail: (message: string) => never = (message) => {
    throw new S3VectorsError(
      `${message} Ids were taken from ${source}.`,
      S3VectorsErrorCode.VALIDATION,
      {
        operation,
        ...scope,
      },
    );
  };

  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const id: unknown = ids[i];
    if (typeof id !== 'string') {
      fail(`Vector id at index ${i} is not a string (received ${typeof id}).`);
    }
    if (id.length < KEY_MIN_LENGTH) {
      fail(`Vector id at index ${i} is an empty string, but every id must be a non-empty string.`);
    }
    if (id.length > KEY_MAX_LENGTH) {
      fail(
        `Vector id at index ${i} is ${id.length} characters, over the ${KEY_MAX_LENGTH}-character maximum for a vector key.`,
      );
    }
    if (seen.has(id)) {
      fail(
        `Duplicate vector id "${id}" at index ${i} — each id may appear only once per call, ` +
          'since S3 Vectors would silently overwrite the earlier vector with the later one. ' +
          'To overwrite an existing vector, write it in a separate call.',
      );
    }
    seen.add(id);
  }
}
