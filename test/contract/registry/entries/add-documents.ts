import { Document } from '@langchain/core/documents';

import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import { DEFAULT_MAX_CONCURRENT, isWritableDocument, isWriteOptions } from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** `addDocuments(documents, options?)` as one value the corpus can vary. */
type AddDocumentsInput = readonly [documents: unknown, options: unknown];

/**
 * What `addDocuments` accepts, stated from the contract rather than from the code.
 *
 * The embeddings model is not an input: a model that returns something
 * unusable is an ambient condition, so a case under it is in-domain and must
 * fail with a declared code rather than be refused as the caller's mistake.
 */
function accepts([documents, options]: AddDocumentsInput): boolean {
  if (!Array.isArray(documents)) return false;
  if (!isWriteOptions(options, documents.length)) return false;
  for (let index = 0; index < documents.length; index++) {
    if (!isWritableDocument(documents[index])) return false;
  }
  return true;
}

const doc = (metadata?: Record<string, unknown>): Document =>
  new Document({ pageContent: 'page content', ...(metadata ? { metadata } : {}) });

function cases(): readonly ContractCase<AddDocumentsInput>[] {
  const built: ContractCase<AddDocumentsInput>[] = [];

  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `documents = ${value.label}`,
      input: [value.make(), undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `options = ${value.label}`,
      input: [[doc()], value.make()],
      ambient: BENIGN,
    });
    built.push({
      label: `options.ids = ${value.label}`,
      input: [[doc()], { ids: value.make() }],
      ambient: BENIGN,
    });
    built.push({
      label: `options.batchSize = ${value.label}`,
      input: [[doc()], { batchSize: value.make() }],
      ambient: BENIGN,
    });
    built.push({
      label: `options.signal = ${value.label}`,
      input: [[doc()], { signal: value.make() }],
      ambient: BENIGN,
    });
    // Every metadata rule, reached through the path that embeds first: the
    // property that matters here is that a refusal costs no embedding call.
    built.push({
      label: `document metadata value = ${value.label}`,
      input: [[doc({ field: value.make() })], undefined],
      ambient: BENIGN,
    });
  }

  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid write under "${ambient.label}"`,
      input: [[doc(), doc()], { ids: ['k1', 'k2'] }],
      ambient,
    });
  }

  built.push({ label: 'empty input writes nothing', input: [[], undefined], ambient: BENIGN });
  built.push({
    label: 'a duplicate id within one call is refused',
    input: [[doc(), doc()], { ids: ['same', 'same'] }],
    ambient: BENIGN,
  });
  built.push({
    label: 'an already-fired signal aborts',
    input: [[doc()], { signal: AbortSignal.abort() }],
    ambient: BENIGN,
  });
  built.push({
    label: 'the reserved page-content key in document metadata is refused',
    input: [[doc({ _page_content: 'mine' })], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'an id with an unpaired surrogate is refused',
    input: [[doc()], { ids: ['k\ud800'] }],
    ambient: BENIGN,
  });
  built.push({
    label: 'page content with an unpaired surrogate is refused',
    input: [[new Document({ pageContent: 'x\ud800' })], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'a metadata key with an unpaired surrogate is refused',
    input: [[doc({ ['k\ud800']: 'v' })], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'metadata S3 Vectors rejects in a later batch is refused before anything is spent',
    input: [[doc(), doc({ field: null })], { batchSize: 1 }],
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
/** What a failure after the write started carries, so a caller can reconcile it. */
const WRITE_FAILURE = [...SCOPE, 'writtenIds', 'attemptedIds'];
/** A failed AWS request also names the request, whichever of the write's commands it was. */
const REQUEST_FAILURE = [...WRITE_FAILURE, 'awsCommand'];

/** The executable contract for `AmazonS3Vectors.addDocuments`. */
export const addDocumentsContract: EntryPointContract<AddDocumentsInput> = {
  symbol: 'AmazonS3Vectors.addDocuments',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.EMBEDDINGS_MISSING,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    S3VectorsErrorCode.UNEXPECTED_ERROR,
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
    [S3VectorsErrorCode.EMBEDDINGS_MISSING]: SCOPE,
    [S3VectorsErrorCode.INDEX_CONFIG_MISMATCH]: SCOPE,
    // An embeddings model that throws fails a batch like any other failure does.
    [S3VectorsErrorCode.UNEXPECTED_ERROR]: WRITE_FAILURE,
    [S3VectorsErrorCode.THROTTLED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.ACCESS_DENIED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REJECTED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.NOT_FOUND]: REQUEST_FAILURE,
    [S3VectorsErrorCode.SERVICE_UNAVAILABLE]: REQUEST_FAILURE,
    [S3VectorsErrorCode.QUOTA_EXCEEDED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.KMS_ERROR]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REQUEST_FAILED]: REQUEST_FAILURE,
  },
  accepts,
  invoke: async (store: AmazonS3Vectors, [documents, options]: AddDocumentsInput) =>
    await store.addDocuments(
      documents as Document[],
      options as Parameters<AmazonS3Vectors['addDocuments']>[1],
    ),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
};
