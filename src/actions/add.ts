/**
 * Hides the order a write happens in.
 *
 * Every check a write can fail, the embedding call, id resolution, the split
 * into requests and the pacing between them are sequenced here, and the
 * sequence is the decision: what is refused before a billable `embedQuery`,
 * what is refused before the first request, and what a failure carries once
 * some batches have already committed. A caller sees documents in and ids out.
 * Change the order — validate later, embed earlier, batch differently — and
 * only this module changes.
 */
import type { DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { runBatches } from '../internal/concurrency.js';
import { embedAndWrite } from '../internal/embed-pipeline.js';
import {
  assertBatchSize,
  assertDocumentObjects,
  assertIdsOption,
  assertIsArray,
  validationError,
} from '../internal/guards.js';
import { assertIdsUnique, assertIdsWellFormed, resolveWriteIds } from '../internal/ids.js';
import { assertWriteVectors } from '../internal/limits.js';
import { prepareRecords, type WriteRecord } from '../internal/records.js';
import { requestRuns } from '../internal/request-size.js';
import { checkAborted } from '../internal/signals.js';
import { describeValue } from '../shared/describe.js';
import { wrapEmbeddingsError } from '../shared/errors/wrap-error.js';
import type { MetadataConfig } from '../shared/metadata.js';
import type { StoreScope } from '../shared/scope.js';
import type { DistanceMetric } from '../types.js';

/** "Vectors per PutVectors call: 500" (limits page, `s3-vectors-limitations.html`). */
const MAX_PUT_BATCH_SIZE = 500;
/** Below the AWS ceiling, so a default-configured store never fails on batch size. */
const DEFAULT_PUT_BATCH_SIZE = 200;
/** Where a write's ids came from when the caller supplied none. */
const DOCUMENT_ID_SOURCE =
  "the documents' own `id` fields (a UUID is generated only for a document with no id at all)";

/** The store configuration every write applies to its input. */
export interface WriteConfig extends MetadataConfig {
  /** The index's metric; decides whether a zero vector is writable. */
  readonly distanceMetric: DistanceMetric;
}

/** Writes one validated batch; the store binds its client and index lifecycle to it. */
type PutBatchFn = (
  operation: string,
  batchOffset: number,
  records: readonly WriteRecord[],
  vectors: readonly number[][],
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
  /**
   * Vectors per batch: 1–500, defaulting to 200. A batch is one `PutVectors`
   * call unless its body would exceed the 20 MiB AWS accepts, in which case it
   * is split across several — the count is the caller's ceiling, not a promise
   * about the number of requests.
   */
  readonly batchSize?: number | undefined;
  /** How many of those calls may be in flight at once. */
  readonly maxConcurrent: number;
  /** Cancels the writes in flight and stops later batches from starting. */
  readonly signal?: AbortSignal | undefined;
  /** The store configuration the input is validated and built against. */
  readonly writeConfig: WriteConfig;
  /** Writes one validated batch. */
  readonly putBatch: PutBatchFn;
}

export interface AddDocumentsOptions extends Omit<AddVectorsOptions, 'vectors'> {
  /**
   * Resolves the indexing model, called once — after every input check (the
   * document/id/batch-size shape) and the already-fired-signal check, and
   * only when `documents` is non-empty. A caller relies on this: an invalid
   * call on a model-less store is `VALIDATION`, not `EMBEDDINGS_MISSING`, and
   * `addDocuments([])` on a model-less store resolves `[]` without ever
   * calling this. Once called, the returned model is used per batch, never
   * concurrently with itself, and its output is checked to be exactly one
   * usable vector per document.
   */
  readonly getEmbeddings: () => EmbeddingsInterface;
}

/**
 * Resolve the ids for a write and check everything about them.
 *
 * Accepts: the documents, and the caller's `ids` if any — `undefined` and
 * `null` both meaning none.
 *
 * Returns: one id per document — the caller's, else the document's own `id`
 * (which is what makes a read-modify-write round trip update in place), else a
 * fresh UUID.
 *
 * Throws: `VALIDATION` when `ids` is not an array, when a document is not an
 * object with a string `pageContent`, when the count disagrees with the
 * documents, or when any resolved id is not a 1–1024 character well-formed
 * string or is repeated within the call — per-element refusals carrying
 * `recordIndex`.
 *
 * Guarantees: validated **before** the empty-input short-circuit. A caller
 * passing a stale `ids` array alongside an empty document array has made a real
 * mistake, and swallowing it into a no-op success would hide it.
 */
function resolveIds(
  operation: string,
  scope: StoreScope,
  documents: DocumentInterface[],
  given: string[] | null | undefined,
  countLabel: string,
  count: number,
): string[] {
  // `null` is "not given", as it is for the options bag itself, a signal, a
  // filter and a client: a DTO layer defaulting an absent field to `null` means
  // absence. `ids` alone read it as a value, and refused the write.
  const ids = given ?? undefined;
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
  const idCheck = {
    operation,
    ...scope,
    source: ids === undefined ? DOCUMENT_ID_SOURCE : 'options.ids',
  };
  assertIdsWellFormed(resolved, idCheck);
  assertIdsUnique(resolved, idCheck);
  return resolved;
}

/**
 * Store caller-supplied vectors alongside their documents.
 *
 * Accepts: equal-length `vectors` and `documents`, an optional `ids` list, a
 * `batchSize` of 1–500, a signal, and the store's write configuration.
 *
 * Returns: the ids written, in document order, in an array this call owns.
 *
 * Throws, before any AWS request:
 * - `VALIDATION` for a non-array argument, mismatched counts, a malformed or
 *   repeated id, a bad batch size, a document or metadata S3 Vectors cannot
 *   store, or a vector it cannot store — not an array, a dimension outside
 *   1–4096, a non-finite component, or zero norm on a cosine index. Each
 *   refusal about one element carries `recordIndex` and, where known, `recordId`.
 * - `INDEX_CONFIG_MISMATCH` for a vector whose dimension differs from the first
 *   vector's, anywhere in the input.
 *
 * Otherwise whatever the write raises — `ABORTED` for the signal, whatever index
 * creation raises, or the class the `PutVectors` failure maps to — carrying
 * `context.writtenIds` and `context.attemptedIds`.
 *
 * Guarantees:
 * - Every check on the input runs over all of it before the first request, so
 *   an input that cannot be written is refused whole, never written in part. A
 *   partial write can only come from AWS or from an abort.
 * - The `vectors` and `documents` lists and each document's metadata are taken
 *   once, so a caller mutating them while the promise is pending cannot change
 *   what is written. A vector's own component array is not copied — that would
 *   double peak vector memory — so mutating one mid-write is outside this
 *   contract.
 * - One order, on every call: every check the arguments alone decide (counts,
 *   ids, batch size, documents, metadata, vectors) runs first; only once all of
 *   it passes does an already-fired signal get to raise `ABORTED`; only once
 *   both pass does an empty input return `[]`, still without a request.
 * - The first batch is written alone, because it is the one that may create the
 *   index; the rest run at most `maxConcurrent` at a time.
 * - No request exceeds the 20 MiB body AWS accepts: a batch whose vectors and
 *   metadata would not fit one is split across several, before the first
 *   request rather than after AWS refuses it.
 */
export async function addVectors(opts: AddVectorsOptions): Promise<string[]> {
  const { vectors, documents, signal, writeConfig } = opts;
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

  const batchSize = opts.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
  assertBatchSize('addVectors', scope, batchSize, MAX_PUT_BATCH_SIZE);

  const records = prepareRecords(documents, ids, {
    operation: 'addVectors',
    ...scope,
    ...writeConfig,
  });
  // Taken before it is checked, so the list checked is the list written.
  const vectorSnapshot = [...vectors];
  assertWriteVectors(vectorSnapshot, {
    operation: 'addVectors',
    ...scope,
    distanceMetric: writeConfig.distanceMetric,
    offset: 0,
    ids,
  });

  // Everything above is decided by the arguments alone; only once all of it
  // passes does an already-fired signal get to matter, and only once both
  // pass does an empty input get to short-circuit for free.
  checkAborted('addVectors', signal, scope);
  if (vectors.length === 0) return [];

  await runBatches({
    // By count *and* by size: `batchSize` records, and never a body over the
    // 20 MiB AWS accepts. Both vectors and metadata are already in hand here,
    // so the split happens before the first request and every batch below is
    // exactly one of them.
    batches: requestRuns(records, vectorSnapshot[0]!.length, batchSize, scope),
    ids,
    maxConcurrent: opts.maxConcurrent,
    // The first request is the one that creates the index.
    serializeFirstBatch: true,
    operation: 'addVectors',
    contextField: 'writtenIds',
    ...scope,
    action: (batch, offset) =>
      opts.putBatch(
        'addVectors',
        offset,
        batch,
        vectorSnapshot.slice(offset, offset + batch.length),
        signal,
      ),
  });

  return ids;
}

/**
 * Embed documents and store them.
 *
 * Accepts: the documents, an optional `ids` list, a `batchSize` of 1–500, a
 * signal, a way to resolve the embeddings model to use for indexing, and the
 * store's write configuration.
 *
 * Returns: the ids written, in document order, in an array this call owns.
 *
 * Throws, before any embedding call or AWS request: `VALIDATION` for a non-array
 * argument, a mismatched count, a malformed or repeated id, a bad batch size, or
 * a document or metadata S3 Vectors cannot store — each refusal about one
 * document carrying `recordIndex` and, where known, `recordId`; `ABORTED` for an
 * already-fired signal. `EMBEDDINGS_MISSING` when no model is configured is
 * raised only once every check above has passed and `documents` is non-empty —
 * `addDocuments([])` on a model-less store resolves `[]` without ever asking for
 * one.
 *
 * Throws, for a batch the model has embedded, before that batch is written:
 * - `VALIDATION` when the model returns something other than an array, the
 *   wrong number of vectors, or a vector S3 Vectors cannot store;
 * - `INDEX_CONFIG_MISMATCH` when the batch's vectors disagree on dimension.
 *
 * Every failure after the first batch started — those above, an embeddings
 * model that throws (`EMBEDDINGS_FAILED`), `ABORTED`, or an AWS failure —
 * carries `context.writtenIds` and `context.attemptedIds`.
 *
 * Guarantees:
 * - Everything knowable from the input is checked over all of it before the
 *   first embedding call, so an input that cannot be written costs no embedding
 *   and no request. Only the model's own output is checked per batch, because it
 *   does not exist sooner.
 * - One order, on every call: every check the arguments alone decide runs
 *   first; only once it passes does an already-fired signal get to raise
 *   `ABORTED`; only once both pass does an empty `documents` return `[]`; only
 *   for a non-empty, valid, un-aborted call is the embeddings model resolved at
 *   all, so a model-less store still tells VALIDATION from EMBEDDINGS_MISSING
 *   from "nothing to do".
 * - What is embedded and what is stored are the page content as it was when the
 *   call started.
 * - The per-batch vector count is checked against the batch's document count. A
 *   model that silently drops an entry — one that skips empty strings, say —
 *   would otherwise pair every later vector with the wrong document and id.
 */
export async function addDocuments(opts: AddDocumentsOptions): Promise<string[]> {
  const { documents, signal, writeConfig } = opts;
  const scope: StoreScope = {
    vectorBucketName: opts.vectorBucketName,
    indexName: opts.indexName,
  };

  assertIsArray('addDocuments', scope, 'documents', documents);
  const ids = resolveIds('addDocuments', scope, documents, opts.ids, 'documents', documents.length);

  const batchSize = opts.batchSize ?? DEFAULT_PUT_BATCH_SIZE;
  assertBatchSize('addDocuments', scope, batchSize, MAX_PUT_BATCH_SIZE);

  const records = prepareRecords(documents, ids, {
    operation: 'addDocuments',
    ...scope,
    ...writeConfig,
  });

  // Everything above is decided by the arguments alone; only once all of it
  // passes does an already-fired signal get to matter, only once both pass
  // does an empty input get to short-circuit for free, and only for a
  // non-empty call is there anything left to spend on — starting with
  // resolving the embeddings model itself.
  checkAborted('addDocuments', signal, scope);
  if (documents.length === 0) return [];

  const embeddings = opts.getEmbeddings();

  const embed = async (batch: readonly WriteRecord[], offset: number): Promise<number[][]> => {
    let embedded: unknown;
    try {
      embedded = await embeddings.embedDocuments(batch.map((record) => record.text));
    } catch (error: unknown) {
      // Coded here, where it is known to be the model that threw. Left to the
      // pipeline it became whatever a failure nobody had classified becomes —
      // `UNEXPECTED_ERROR`, the same as a bug — and the one failure a caller
      // retries could not be told from the ones they should not.
      throw wrapEmbeddingsError(error, { operation: 'addDocuments', ...scope });
    }
    if (!Array.isArray(embedded)) {
      throw validationError(
        'addDocuments',
        scope,
        `Embeddings model returned ${describeValue(embedded)} instead of an array of vectors.`,
      );
    }
    const vectors = embedded as unknown[];
    if (vectors.length !== batch.length) {
      throw validationError(
        'addDocuments',
        scope,
        `Embeddings model returned ${vectors.length} vectors for ${batch.length} documents — it must return exactly one vector per document.`,
      );
    }
    assertWriteVectors(vectors, {
      operation: 'addDocuments',
      ...scope,
      distanceMetric: writeConfig.distanceMetric,
      offset,
      ids: batch.map((record) => record.key),
    });
    // No cast: the check above narrows the array, which is the whole reason it
    // is declared with an `asserts` signature rather than returning nothing.
    return [...vectors];
  };

  await embedAndWrite({
    operation: 'addDocuments',
    items: records,
    ids,
    batchSize,
    maxConcurrent: opts.maxConcurrent,
    signal,
    embed,
    put: (batch, offset, vectors) => opts.putBatch('addDocuments', offset, batch, vectors, signal),
    ...scope,
  });

  return ids;
}
