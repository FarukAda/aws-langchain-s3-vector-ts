import { Document } from '@langchain/core/documents';

import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** A vector key is 1–1024 characters (`API_S3VectorBuckets_PutInputVector.html`). */
const KEY_MAX_LENGTH = 1024;
/** "Vectors per PutVectors call: 500" (limits page). */
const MAX_BATCH_SIZE = 500;
/** Dimension bounds from the limits page. */
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;
/** The store's default `maxConcurrentBatchCalls`. */
const DEFAULT_MAX_CONCURRENT = 10;

/** `addVectors(vectors, documents, options?)` as one value the corpus can vary. */
type AddVectorsInput = readonly [vectors: unknown, documents: unknown, options: unknown];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortSignalLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { aborted?: unknown; addEventListener?: unknown };
  return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

/**
 * A metadata value S3 Vectors can store as written.
 *
 * Stated independently of `buildPutMetadata`, deliberately. The rule is not
 * "whatever the validator accepts" but "a value whose JSON form is also its
 * wire form" — that is what the byte counter depends on, and stating it here
 * from the rule rather than from the code is what lets this catch the two
 * drifting apart again.
 */
function isStorableMetadataValue(value: unknown): boolean {
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
    const item: unknown = value[index];
    if (typeof item === 'string') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    return false;
  }
  return true;
}

/** A document this store can write: string content, storable metadata. */
function isWritableDocument(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value['pageContent'] !== 'string') return false;
  const metadata: unknown = value['metadata'];
  if (metadata === undefined || metadata === null) return true;
  if (!isPlainObject(metadata)) return false;
  // The page-content key this package adds is reserved, and a document that
  // already uses it is refused rather than silently overwritten.
  if (Object.hasOwn(metadata, '_page_content')) return false;
  return Object.values(metadata).every(isStorableMetadataValue);
}

/** One embedding: 1–4096 finite components, no holes, and not the zero vector. */
function isWritableVector(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length < MIN_DIMENSION || value.length > MAX_DIMENSION) return false;
  let sumOfSquares = 0;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
    const component: unknown = value[index];
    if (typeof component !== 'number' || !Number.isFinite(component)) return false;
    sumOfSquares += component * component;
  }
  // The store under test is cosine, which rejects a zero-norm vector
  // (docs/evidence/zero-vector.md).
  return sumOfSquares !== 0;
}

function acceptsOptions(options: unknown, count: number): boolean {
  if (options === undefined || options === null) return true;
  if (!isPlainObject(options)) return false;

  const ids: unknown = options['ids'];
  if (ids !== undefined && ids !== null) {
    if (!Array.isArray(ids) || ids.length !== count) return false;
    const seen = new Set<string>();
    for (const id of ids as unknown[]) {
      if (typeof id !== 'string' || id.length < 1 || id.length > KEY_MAX_LENGTH) return false;
      // Unlike delete, a repeat here loses a document: S3 Vectors takes both
      // and the later one silently overwrites the earlier.
      if (seen.has(id)) return false;
      seen.add(id);
    }
  }

  const batchSize: unknown = options['batchSize'];
  if (batchSize !== undefined && batchSize !== null) {
    if (!Number.isInteger(batchSize)) return false;
    const size = batchSize as number;
    if (size < 1 || size > MAX_BATCH_SIZE) return false;
  }

  const signal: unknown = options['signal'];
  if (signal !== undefined && signal !== null && !isAbortSignalLike(signal)) return false;

  return true;
}

function accepts(input: AddVectorsInput): boolean {
  const [vectors, documents, options] = input;
  if (!Array.isArray(vectors) || !Array.isArray(documents)) return false;
  if (vectors.length !== documents.length) return false;
  if (!acceptsOptions(options, documents.length)) return false;
  if (vectors.length === 0) return true;

  if (!(vectors as unknown[]).every(isWritableVector)) return false;
  if (!(documents as unknown[]).every(isWritableDocument)) return false;

  // Every vector in one `PutVectors` call must share a dimension. The default
  // batch size puts every case here in a single batch.
  const first = (vectors as unknown[][])[0];
  return (vectors as unknown[][]).every((vector) => vector.length === first?.length);
}

const VECTOR: number[] = [0.1, 0.2, 0.3];
const doc = (metadata?: Record<string, unknown>): Document =>
  new Document({ pageContent: 'page content', ...(metadata ? { metadata } : {}) });

function cases(): readonly ContractCase<AddVectorsInput>[] {
  const built: ContractCase<AddVectorsInput>[] = [];

  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `vectors = ${value.label}`,
      input: [value.make(), [doc()], undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `documents = ${value.label}`,
      input: [[VECTOR], value.make(), undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `options = ${value.label}`,
      input: [[VECTOR], [doc()], value.make()],
      ambient: BENIGN,
    });
    built.push({
      label: `options.ids = ${value.label}`,
      input: [[VECTOR], [doc()], { ids: value.make() }],
      ambient: BENIGN,
    });
    built.push({
      label: `options.batchSize = ${value.label}`,
      input: [[VECTOR], [doc()], { batchSize: value.make() }],
      ambient: BENIGN,
    });
    built.push({
      label: `options.signal = ${value.label}`,
      input: [[VECTOR], [doc()], { signal: value.make() }],
      ambient: BENIGN,
    });
    // The corpus reaching metadata through a real write is the whole point of
    // sharing it: `NaN` and the sparse array were found here, and every other
    // hostile value now arrives here too without anyone choosing to send it.
    built.push({
      label: `document metadata value = ${value.label}`,
      input: [[VECTOR], [doc({ field: value.make() })], undefined],
      ambient: BENIGN,
    });
    // A vector's own components, which AWS refuses and this package should
    // refuse first, before the write is dispatched.
    built.push({
      label: `vector component = ${value.label}`,
      input: [[[0.1, value.make(), 0.3]], [doc()], undefined],
      ambient: BENIGN,
    });
  }

  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid write under "${ambient.label}"`,
      input: [[VECTOR, [0.4, 0.5, 0.6]], [doc(), doc()], { ids: ['k1', 'k2'] }],
      ambient,
    });
  }

  built.push({
    label: 'empty input writes nothing',
    input: [[], [], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'mismatched lengths are refused',
    input: [[VECTOR], [doc(), doc()], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'a duplicate id within one call is refused',
    input: [[VECTOR, [0.4, 0.5, 0.6]], [doc(), doc()], { ids: ['same', 'same'] }],
    ambient: BENIGN,
  });
  built.push({
    label: 'a zero vector is refused on a cosine index',
    input: [[[0, 0, 0]], [doc()], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'vectors of differing dimension in one batch are refused',
    input: [[VECTOR, [0.4, 0.5]], [doc(), doc()], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'an already-fired signal aborts',
    input: [[VECTOR], [doc()], { signal: AbortSignal.abort() }],
    ambient: BENIGN,
  });
  built.push({
    label: 'the reserved page-content key in document metadata is refused',
    input: [[VECTOR], [doc({ _page_content: 'mine' })], undefined],
    ambient: BENIGN,
  });

  return built;
}

/** The executable contract for `AmazonS3Vectors.addVectors`. */
export const addVectorsContract: EntryPointContract<AddVectorsInput> = {
  symbol: 'AmazonS3Vectors.addVectors',
  docSource: 'src/s3-vectors.ts:addVectors',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    S3VectorsErrorCode.THROTTLED,
    S3VectorsErrorCode.ACCESS_DENIED,
    S3VectorsErrorCode.AWS_REJECTED,
    S3VectorsErrorCode.NOT_FOUND,
    S3VectorsErrorCode.SERVICE_UNAVAILABLE,
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
  ]),
  requiredContext: {
    [S3VectorsErrorCode.VALIDATION]: ['vectorBucketName', 'indexName'],
    [S3VectorsErrorCode.ABORTED]: ['vectorBucketName', 'indexName'],
    [S3VectorsErrorCode.INDEX_CONFIG_MISMATCH]: ['vectorBucketName', 'indexName'],
    [S3VectorsErrorCode.THROTTLED]: ['vectorBucketName', 'indexName', 'writtenIds', 'attemptedIds'],
    [S3VectorsErrorCode.ACCESS_DENIED]: [
      'vectorBucketName',
      'indexName',
      'writtenIds',
      'attemptedIds',
    ],
    [S3VectorsErrorCode.AWS_REJECTED]: [
      'vectorBucketName',
      'indexName',
      'writtenIds',
      'attemptedIds',
    ],
    [S3VectorsErrorCode.NOT_FOUND]: ['vectorBucketName', 'indexName', 'writtenIds', 'attemptedIds'],
    [S3VectorsErrorCode.SERVICE_UNAVAILABLE]: [
      'vectorBucketName',
      'indexName',
      'writtenIds',
      'attemptedIds',
    ],
    [S3VectorsErrorCode.AWS_REQUEST_FAILED]: [
      'vectorBucketName',
      'indexName',
      'writtenIds',
      'attemptedIds',
    ],
  },
  // A batch whose vectors disagree on dimension is refused as
  // INDEX_CONFIG_MISMATCH rather than VALIDATION, deliberately: what the caller
  // has to decide is which index they meant, not how to reshape an argument.
  outOfDomainCodes: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
  ]),
  accepts,
  invoke: async (store: AmazonS3Vectors, input: AddVectorsInput) => {
    const [vectors, documents, options] = input;
    return await store.addVectors(
      vectors as number[][],
      documents as Document[],
      options as Parameters<AmazonS3Vectors['addVectors']>[2],
    );
  },
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
};
