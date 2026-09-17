import type { DocumentInterface } from '@langchain/core/documents';

import { buildPutMetadata } from '../shared/metadata.js';
import type { OperationScope } from './operation.js';

/** Everything a write needs about one document, taken once, before anything is spent. */
export interface WriteRecord {
  /** The vector key the document is written under. */
  readonly key: string;
  /** The page content as it was when the write started: what `addDocuments` embeds. */
  readonly text: string;
  /** The metadata to store, validated, and owned by this record. */
  readonly metadata: Record<string, unknown>;
}

/** The store configuration a record is built against. */
export interface RecordConfig extends OperationScope {
  /** Where page content is stored, or `null` to store none. */
  readonly pageContentMetadataKey: string | null;
  /** The index's non-filterable keys, already merged with the page-content key. */
  readonly nonFilterableKeys: readonly string[];
}

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
  return documents.map((document, index) => ({
    key: ids[index]!,
    text: document.pageContent,
    metadata: buildPutMetadata(document, {
      ...config,
      record: { recordIndex: index, recordId: ids[index]! },
    }),
  }));
}
