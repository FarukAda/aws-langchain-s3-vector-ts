import { Document } from '@langchain/core/documents';

import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import {
  DEFAULT_MAX_CONCURRENT,
  isWritableDocument,
  isWritableVector,
  isWriteOptions,
} from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** `addVectors(vectors, documents, options?)` as one value the corpus can vary. */
type AddVectorsInput = readonly [vectors: unknown, documents: unknown, options: unknown];

/**
 * What `addVectors` accepts, stated from the contract rather than from the code.
 *
 * Every vector in the call shares one dimension — not merely every vector in a
 * batch — because an index has one dimension (userguide
 * `s3-vectors-indexes.html`): a call whose vectors disagree can never be written
 * whole, so it must not be written in part.
 */
function accepts([vectors, documents, options]: AddVectorsInput): boolean {
  if (!Array.isArray(vectors) || !Array.isArray(documents)) return false;
  if (vectors.length !== documents.length) return false;
  if (!isWriteOptions(options, documents.length)) return false;
  for (let index = 0; index < vectors.length; index++) {
    if (!isWritableVector(vectors[index]) || !isWritableDocument(documents[index])) return false;
    if ((vectors[index] as unknown[]).length !== (vectors[0] as unknown[]).length) return false;
  }
  return true;
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

  built.push({ label: 'empty input writes nothing', input: [[], [], undefined], ambient: BENIGN });
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
  // Found by the 2026-09-16 report and probes.
  built.push({
    label: 'an id with an unpaired surrogate is refused',
    input: [[VECTOR], [doc()], { ids: ['k\ud800'] }],
    ambient: BENIGN,
  });
  built.push({
    label: 'page content with an unpaired surrogate is refused',
    input: [[VECTOR], [new Document({ pageContent: 'x\ud800' })], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'a metadata key with an unpaired surrogate is refused',
    input: [[VECTOR], [doc({ ['k\ud800']: 'v' })], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'a null vector after the first is refused',
    input: [[VECTOR, null], [doc(), doc()], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'vectors of differing dimension across batches are refused before any write',
    input: [[VECTOR, [0.4, 0.5]], [doc(), doc()], { batchSize: 1 }],
    ambient: BENIGN,
  });
  built.push({
    label: 'metadata S3 Vectors rejects in a later batch is refused before any write',
    input: [[VECTOR, [0.4, 0.5, 0.6]], [doc(), doc({ field: null })], { batchSize: 1 }],
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
/** What a failure after the write started carries, so a caller can reconcile it. */
const WRITE_FAILURE = [...SCOPE, 'writtenIds', 'attemptedIds'];
/** A failed AWS request also names the request, whichever of the write's commands it was. */
const REQUEST_FAILURE = [...WRITE_FAILURE, 'awsCommand'];

/** The executable contract for `AmazonS3Vectors.addVectors`. */
export const addVectorsContract: EntryPointContract<AddVectorsInput> = {
  symbol: 'AmazonS3Vectors.addVectors',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    S3VectorsErrorCode.THROTTLED,
    S3VectorsErrorCode.ACCESS_DENIED,
    S3VectorsErrorCode.AWS_REJECTED,
    S3VectorsErrorCode.NOT_FOUND,
    S3VectorsErrorCode.SERVICE_UNAVAILABLE,
    S3VectorsErrorCode.QUOTA_EXCEEDED,
    S3VectorsErrorCode.KMS_ERROR,
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
  ]),
  requiredContext: {
    [S3VectorsErrorCode.VALIDATION]: SCOPE,
    [S3VectorsErrorCode.ABORTED]: SCOPE,
    [S3VectorsErrorCode.INDEX_CONFIG_MISMATCH]: SCOPE,
    [S3VectorsErrorCode.THROTTLED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.ACCESS_DENIED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REJECTED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.NOT_FOUND]: REQUEST_FAILURE,
    [S3VectorsErrorCode.SERVICE_UNAVAILABLE]: REQUEST_FAILURE,
    [S3VectorsErrorCode.QUOTA_EXCEEDED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.KMS_ERROR]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REQUEST_FAILED]: REQUEST_FAILURE,
  },
  // Vectors that disagree on dimension, anywhere in the call, are refused as
  // INDEX_CONFIG_MISMATCH rather than VALIDATION, deliberately: what the caller
  // has to decide is which index they meant, not how to reshape an argument.
  outOfDomainCodes: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
  ]),
  accepts,
  invoke: async (store: AmazonS3Vectors, [vectors, documents, options]: AddVectorsInput) =>
    await store.addVectors(
      vectors as number[][],
      documents as Document[],
      options as Parameters<AmazonS3Vectors['addVectors']>[2],
    ),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
};
