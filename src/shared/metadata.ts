import { Document, type DocumentInterface } from '@langchain/core/documents';

import type { S3OutputVector } from '../types.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

/**
 * Build the metadata object to send alongside a PutVectors call.
 *
 * Pure function extracted from AmazonS3Vectors. Takes pageContentMetadataKey
 * and the calling operation name explicitly to keep the helper free of class
 * state while still producing correctly-labeled errors.
 *
 * @throws {S3VectorsError} if the document's own metadata already uses the
 *         reserved `pageContentMetadataKey` — that key is reserved for
 *         internal pageContent round-tripping and would otherwise be
 *         silently overwritten.
 */
export function buildPutMetadata(
  doc: DocumentInterface,
  pageContentMetadataKey: string | null,
  operation: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...doc.metadata };

  if (pageContentMetadataKey !== null) {
    if (Object.hasOwn(metadata, pageContentMetadataKey)) {
      throw new S3VectorsError(
        `Document metadata already contains reserved key '${pageContentMetadataKey}' ` +
          '(used internally to store pageContent). Rename this metadata field or configure ' +
          'a different `pageContentMetadataKey`.',
        S3VectorsErrorCode.VALIDATION,
        { operation },
      );
    }
    metadata[pageContentMetadataKey] = doc.pageContent;
  }

  return metadata;
}

/**
 * Reconstruct a LangChain `Document` from an S3 vector response.
 *
 * @param vector - The raw S3 output vector.
 * @param pageContentMetadataKey - The key under which pageContent is stored
 *        in metadata, or `null` if pageContent is not round-tripped.
 * @param deepCopyMetadata - When `true`, the returned metadata is deep-cloned
 *        via structuredClone, preventing shared-reference mutations between
 *        documents that originate from the same vector (duplicate-id case).
 * @param operation - Logical operation name used to label a coded error if
 *        the deep clone fails.
 *
 * @throws {S3VectorsError} if `deepCopyMetadata` is `true` and the vector's
 *         metadata contains a value `structuredClone` cannot clone (e.g. a
 *         function or symbol) — reachable via a custom client or a
 *         non-conforming mocked response.
 */
export function createDocument(
  vector: S3OutputVector,
  pageContentMetadataKey: string | null,
  deepCopyMetadata = false,
  operation = 'createDocument',
): Document {
  let pageContent = '';
  const rawMeta = vector.metadata ?? {};
  let metadata: Record<string, unknown>;

  if (deepCopyMetadata) {
    try {
      metadata = structuredClone(rawMeta);
    } catch (cause) {
      throw new S3VectorsError(
        `Failed to deep-copy metadata for vector '${vector.key}': it contains a value ` +
          'that cannot be structured-cloned (e.g. a function or symbol). Ensure vector ' +
          'metadata contains only structured-cloneable values.',
        S3VectorsErrorCode.VALIDATION,
        { operation },
        cause,
      );
    }
  } else {
    metadata = { ...rawMeta };
  }

  if (pageContentMetadataKey !== null && Object.hasOwn(metadata, pageContentMetadataKey)) {
    const rawValue = metadata[pageContentMetadataKey];
    if (typeof rawValue === 'string') {
      pageContent = rawValue;
      delete metadata[pageContentMetadataKey];
    }
    // A non-string value under this key was never written by this library —
    // buildPutMetadata always stores a string — so it belongs to whatever
    // else shares the index. pageContent stays '' (unchanged, intentional,
    // and tested), but the value is left in metadata rather than silently
    // deleted, so a caller can still see and reconcile it. Deleting a value
    // this function did not consume would lose caller data with no flag,
    // inconsistent with this library's fail-closed handling elsewhere.
  }

  return new Document({ pageContent, id: vector.key, metadata });
}
