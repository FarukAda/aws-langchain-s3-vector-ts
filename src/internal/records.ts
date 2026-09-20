/**
 * Hides the record shape `PutVectors` takes.
 *
 * A document has page content and metadata; a record has an id, a vector and one
 * flat metadata object with the content folded into it. Where the content goes,
 * and that it goes anywhere at all, is this module's decision — which is why a
 * store can be configured to store no content and nothing else changes.
 */
import type { DocumentInterface } from '@langchain/core/documents';

import { buildPutMetadata, type MetadataConfig } from '../shared/metadata.js';
import type { OperationScope } from '../shared/scope.js';

/** Everything a write needs about one document, taken once, before anything is spent. */
export interface WriteRecord {
  /** The vector key the document is written under. */
  readonly key: string;
  /** The page content as it was when the write started: what `addDocuments` embeds. */
  readonly text: string;
  /** The metadata to store, validated, and owned by this record. */
  readonly metadata: Record<string, unknown>;
  /**
   * The bytes that metadata was measured at when it was validated. Carried so a
   * write can bound its `PutVectors` request size without serialising the batch
   * again (`internal/request-size.ts`).
   */
  readonly metadataBytes: number;
}

/** The store configuration a record is built against. */
export type RecordConfig = MetadataConfig & OperationScope;

/**
 * Build and validate every record of one write.
 *
 * Accepts: `documents` already passed by `assertDocumentObjects`, and `ids`
 * already passed by `assertIdsWellFormed` — one per document, in order.
 *
 * Returns: one {@link WriteRecord} per document, in document order, in an array
 * this call owns.
 *
 * Throws: {@link S3VectorsError} with code `VALIDATION` for the first document
 * whose metadata S3 Vectors cannot store, carrying `recordIndex` and `recordId`
 * (see `buildPutMetadata`).
 *
 * Guarantees: it runs over the whole input, so a write that cannot be stored is
 * refused before its first embedding call and its first AWS request. What it
 * returns is exactly what gets written: the page content is read once, and the
 * metadata is a copy.
 */
export function prepareRecords(
  documents: readonly DocumentInterface[],
  ids: readonly string[],
  config: RecordConfig,
): WriteRecord[] {
  return documents.map((document, index) => {
    const { metadata, metadataBytes } = buildPutMetadata(document, {
      ...config,
      record: { recordIndex: index, recordId: ids[index]! },
    });
    return { key: ids[index]!, text: document.pageContent, metadata, metadataBytes };
  });
}
