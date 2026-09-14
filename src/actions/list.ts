import type { Document } from '@langchain/core/documents';

import { listPages } from '../internal/list-pages.js';
import type { AwsOperation } from '../internal/operation.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { createDocument } from '../shared/metadata.js';
import type { S3VectorsRecord } from '../types.js';

export interface EnumerateOptions extends AwsOperation {
  /** Where page content is stored, so `createDocument` can lift it back out. */
  readonly pageContentMetadataKey: string | null;
  /** 1–1000, advisory: the 1 MB page cap may return fewer. */
  readonly pageSize?: number | undefined;
}

/**
 * Every document in the index, one at a time.
 *
 * Accepts: `pageSize` (1–1000, advisory) and `signal`, both as
 * {@link listPages} defines them.
 *
 * Returns: an async generator of documents, mapped by the same
 * {@link createDocument} the search paths and `getByIds` use, so enumeration
 * cannot drift from what the rest of the package returns. Order is whatever
 * the service returns; none is promised, because none is documented.
 *
 * Throws: whatever {@link listPages} raises — `VALIDATION` for `pageSize`
 * before any request, `ABORTED`, `ACCESS_DENIED` naming
 * `s3vectors:GetVectors`, or the class the failure maps to, carrying how far
 * the listing got.
 *
 * Requests metadata but not vector data, which is the cheap page: at 1,536
 * dimensions a vector is roughly 24 KB of JSON numbers, so the 1 MB cap ends a
 * page of vectors an order of magnitude sooner than a page of metadata.
 */
export async function* listDocuments(opts: EnumerateOptions): AsyncGenerator<Document> {
  for await (const vector of listPages({ ...opts, returnData: false, returnMetadata: true })) {
    yield createDocument(vector, opts.pageContentMetadataKey, opts.operation);
  }
}

/**
 * Every vector in the index with its embedding, one at a time.
 *
 * Accepts: the same options as {@link listDocuments}.
 *
 * Returns: an async generator of `{ id, vector, document }` — everything
 * needed to write the same record into another index, which is the one
 * migration path AWS leaves open when a dimension or distance metric must
 * change, since both are fixed at index creation.
 *
 * Throws: what {@link listDocuments} throws, plus `AWS_INVALID_RESPONSE` when
 * a record comes back without data despite `returnData: true`. Absent data is
 * not skipped: a migration that silently dropped records would produce a
 * target index that looks complete and is not.
 */
export async function* listVectors(opts: EnumerateOptions): AsyncGenerator<S3VectorsRecord> {
  for await (const vector of listPages({ ...opts, returnData: true, returnMetadata: true })) {
    const data = vector.data?.float32;
    if (data === undefined) {
      throw new S3VectorsError(
        `ListVectors returned vector '${vector.key}' without data, even though this call ` +
          'requested returnData: true. The response may be malformed, or come from an ' +
          'incompatible SDK version or a mocked/stubbed client.',
        S3VectorsErrorCode.AWS_INVALID_RESPONSE,
        {
          operation: opts.operation,
          vectorBucketName: opts.vectorBucketName,
          indexName: opts.indexName,
        },
      );
    }
    yield {
      id: vector.key,
      vector: data,
      document: createDocument(vector, opts.pageContentMetadataKey, opts.operation),
    };
  }
}
