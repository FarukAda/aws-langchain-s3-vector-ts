import type { DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { runBatchesConcurrently } from '../internal/concurrency.js';
import { embedAndWrite } from '../internal/embed-pipeline.js';
import {
  assertBatchSize,
  assertDocumentObjects,
  assertIdsOption,
  assertIsArray,
  validationError,
} from '../internal/guards.js';
import { assertIdsWellFormed, resolveWriteIds } from '../internal/ids.js';
import type { StoreScope } from '../internal/signals.js';
import { chunk } from '../shared/batching.js';

/** "Vectors per PutVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
const MAX_PUT_BATCH_SIZE = 500;
/** Below the AWS ceiling, so a default-configured store never fails on batch size. */
const DEFAULT_PUT_BATCH_SIZE = 200;

/** Writes one already-embedded batch; the store binds its own configuration to it. */
type PutBatchFn = (
  operation: string,
  batchOffset: number,
  vectors: number[][],
  documents: DocumentInterface[],
  ids: string[],
  signal?: AbortSignal,
) => Promise<void>;

export interface AddVectorsOptions extends StoreScope {
  /** The embeddings to store, one per document. */
  readonly vectors: number[][];
  /** Their documents, positionally. */
  readonly documents: DocumentInterface[];
  /**
   * Caller-supplied ids. Omitted, each document's own `id` is used and a fresh
   * UUID minted only where there is none.
   */
  readonly ids?: string[] | undefined;
  /** Vectors per `PutVectors` call: 1–500, defaulting to 200. */
  readonly batchSize?: number | undefined;
  /** How many of those calls may be in flight at once. */
  readonly maxConcurrent: number;
  /** Cancels the writes in flight and stops later batches from starting. */
  readonly signal?: AbortSignal | undefined;
  /** Writes one batch; the store binds its own index configuration to it. */
  readonly putBatch: PutBatchFn;
}

export interface AddDocumentsOptions extends Omit<AddVectorsOptions, 'vectors'> {
  /**
   * The indexing model. Called once per batch, never concurrently with
   * itself, and checked to return exactly one vector per document.
   */
  readonly embeddings: EmbeddingsInterface;
}

/**
 * Resolve the ids for a write and check everything about them.
 *
 * Accepts: the documents, and the caller's `ids` if any.
 *
 * Returns: one id per document — the caller's, else the document's own `id`
 * (which is what makes a read-modify-write round trip update in place), else a
 * fresh UUID.
 *
 * Throws: `VALIDATION` when `ids` is not an array, when its length disagrees
 * with the documents, or when any resolved id is empty, over-long or repeated
 * within the call.
 *
 * Guarantees: validated **before** the empty-input short-circuit. A caller
 * passing a stale `ids` array alongside an empty document array has made a real
 * mistake, and swallowing it into a no-op success would hide it.
 */
function resolveIds(
  operation: string,
  scope: StoreScope,
  documents: DocumentInterface[],
  ids: string[] | undefined,
  countLabel: string,
  count: number,
): string[] {
  assertIdsOption(operation, scope, ids);
  assertDocumentObjects(operation, scope, documents);
  const resolved = resolveWriteIds(documents, ids);
  if (resolved.length !== count) {
    throw validationError(
      operation,
      scope,
      `Number of IDs (${resolved.length}) must match number of ${countLabel} (${count})`,
    );
  }
  assertIdsWellFormed(resolved, operation, scope, ids !== undefined);
  return resolved;
}

/**
 * Store caller-supplied vectors alongside their documents.
 *
 * Accepts: equal-length `vectors` and `documents`, an optional `ids` list, a
 * `batchSize` of 1–500, and a signal.
 *
 * Returns: the ids written, in document order.
 *
 * Throws: `VALIDATION` for mismatched counts, a malformed id or batch size —
 * all before any AWS call; otherwise whatever the write raises, carrying
 * `context.writtenIds` and `context.attemptedIds`.
 *
 * Guarantees: an empty input writes nothing and returns `[]`, but only after
 * its ids have been validated. The first batch is written alone because it is
 * the one that may create the index; the rest run at most `maxConcurrent` at a
 * time.
 */
export async function addVectors(opts: AddVectorsOptions): Promise<string[]> {
  const { vectors, documents, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertIsArray('addVectors', scope, 'vectors', vectors);
  assertIsArray('addVectors', scope, 'documents', documents);
  if (vectors.length !== documents.length) {
    throw validationError(
      'addVectors',
      scope,
      `Number of vectors (${vectors.length}) must match number of documents (${documents.length})`,
    );
  }

  const ids = resolveIds('addVectors', scope, documents, opts.ids, 'vectors', vectors.length);
  if (vectors.length === 0) return [];

  const batchSize = opts.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
  assertBatchSize('addVectors', scope, batchSize, MAX_PUT_BATCH_SIZE);

  // Each batch is sliced when it is dispatched, not now, so the array has to be
  // this call's own by then: a caller mutating theirs while the promise is
  // pending would otherwise change what later batches write. `chunk` already
  // copies the vectors, and `resolveWriteIds` already copies the ids; the
  // documents are the third input read the same way.
  const documentSnapshot = [...documents];

  await runBatchesConcurrently(
    chunk(vectors, batchSize),
    ids,
    opts.maxConcurrent,
    { operation: 'addVectors', ...scope },
    (batch, offset) =>
      opts.putBatch(
        'addVectors',
        offset,
        batch,
        documentSnapshot.slice(offset, offset + batch.length),
        ids.slice(offset, offset + batch.length),
        signal,
      ),
  );

  return ids;
}

/**
 * Embed documents and store them.
 *
 * Accepts: the documents, an optional `ids` list, a `batchSize` of 1–500, a
 * signal, and the embeddings model to use for indexing.
 *
 * Returns: the ids written, in document order.
 *
 * Throws: `VALIDATION` for mismatched counts, a malformed id or batch size, or
 * an embeddings model that returns the wrong number of vectors; otherwise
 * whatever the embed or the write raises, carrying `context.writtenIds` and
 * `context.attemptedIds`.
 *
 * Guarantees: the per-batch vector count is checked against the batch's
 * document count. A model that silently drops an entry — one that skips empty
 * strings, say — would otherwise re-pair every later vector with the wrong
 * document and id through the index-based zip the write path performs, storing
 * each document's embedding under its neighbour's key.
 */
export async function addDocuments(opts: AddDocumentsOptions): Promise<string[]> {
  const { documents, signal } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertIsArray('addDocuments', scope, 'documents', documents);
  const ids = resolveIds('addDocuments', scope, documents, opts.ids, 'documents', documents.length);
  if (documents.length === 0) return [];

  const batchSize = opts.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
  assertBatchSize('addDocuments', scope, batchSize, MAX_PUT_BATCH_SIZE);

  const embed = async (batch: DocumentInterface[]): Promise<number[][]> => {
    const vectors = await opts.embeddings.embedDocuments(batch.map((doc) => doc.pageContent));
    if (vectors.length !== batch.length) {
      throw validationError(
        'addDocuments',
        scope,
        `Embeddings model returned ${vectors.length} vectors for ${batch.length} documents — it must return exactly one vector per document.`,
      );
    }
    return vectors;
  };

  await embedAndWrite({
    operation: 'addDocuments',
    documents,
    ids,
    batchSize,
    maxConcurrent: opts.maxConcurrent,
    signal,
    embed,
    put: (batch, offset, vectors) =>
      opts.putBatch(
        'addDocuments',
        offset,
        vectors,
        batch,
        ids.slice(offset, offset + batch.length),
        signal,
      ),
    ...scope,
  });

  return ids;
}
