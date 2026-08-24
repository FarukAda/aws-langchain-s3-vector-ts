import { Document } from '@langchain/core/documents';

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
  doc: Document,
  pageContentMetadataKey: string | null,
  operation: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...doc.metadata };

  if (pageContentMetadataKey !== null) {
    if (pageContentMetadataKey in metadata) {
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
 */
export function createDocument(
  vector: S3OutputVector,
  pageContentMetadataKey: string | null,
  deepCopyMetadata = false,
): Document {
  let pageContent = '';
  const rawMeta = vector.metadata ?? {};
  const metadata: Record<string, unknown> = deepCopyMetadata
    ? structuredClone(rawMeta)
    : { ...rawMeta };

  if (pageContentMetadataKey !== null && pageContentMetadataKey in metadata) {
    const rawValue = metadata[pageContentMetadataKey];
    pageContent = typeof rawValue === 'string' ? rawValue : '';

    delete metadata[pageContentMetadataKey];
  }

  return new Document({ pageContent, id: vector.key, metadata });
}
