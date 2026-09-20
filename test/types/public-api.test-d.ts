import type { Document, DocumentInterface } from '@langchain/core/documents';

import { AmazonS3Vectors, AmazonS3VectorsRetriever } from '../../src/index.js';
import type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  S3VectorsErrorContext,
  S3VectorsRecord,
} from '../../src/index.js';

const metric: DistanceMetric = 'cosine';
// @ts-expect-error -- 'manhattan' is not a valid DistanceMetric
const badMetric: DistanceMetric = 'manhattan';

const config: AmazonS3VectorsConfig = { vectorBucketName: 'b', indexName: 'idx' };
// @ts-expect-error -- vectorBucketName is required
const badConfig: AmazonS3VectorsConfig = { indexName: 'idx' };

const store = new AmazonS3Vectors(undefined, config);
const storeType: string = store._vectorstoreType();

// similaritySearch matches VectorStore's base signature, including the 4th
// callbacks param (unused by this store, but must type-check for callers
// that pass one — regression coverage for the base-class arity break that
// was introduced and fixed within this same unreleased branch).
const searchResults: Promise<Document[]> = store.similaritySearch('q', 4, undefined, undefined);

// similaritySearchWithRelevanceScores returns [Document, number][] tuples.
const relevanceResults: Promise<[Document, number][]> = store.similaritySearchWithRelevanceScores(
  'q',
  4,
);

void metric;
void badMetric;
void badConfig;
void storeType;
void searchResults;
void relevanceResults;

// similaritySearchWithRelevanceScores takes the AbortSignal in the 5th slot,
// like its text-based siblings. The 4th slot is Callbacks only: a signal
// there fails to compile (and, from JavaScript, is rejected with VALIDATION)
// instead of being honored as the historical position it was in 0.x.
const relevanceAbortLegacy: Promise<[Document, number][]> =
  // @ts-expect-error -- the 4th argument is Callbacks, not AbortSignal
  store.similaritySearchWithRelevanceScores('q', 4, undefined, new AbortController().signal);
const relevanceAbortAligned: Promise<[Document, number][]> =
  store.similaritySearchWithRelevanceScores(
    'q',
    4,
    undefined,
    undefined,
    new AbortController().signal,
  );

void relevanceAbortLegacy;
void relevanceAbortAligned;

// The write methods accept DocumentInterface — a plain object shaped like a
// Document, not only a `Document` class instance — matching @langchain/core's
// own VectorStore.addDocuments/addVectors signatures, so a caller holding
// documents from another LangChain package (or a structuredClone'd copy)
// can pass them without re-wrapping.
const plainDoc: DocumentInterface = { pageContent: 'p', metadata: {} };
const addDocsPlain: Promise<string[]> = store.addDocuments([plainDoc]);
const addVectorsPlain: Promise<string[]> = store.addVectors([[1, 2, 3]], [plainDoc]);
const fromDocsPlain: Promise<AmazonS3Vectors> = AmazonS3Vectors.fromDocuments(
  [plainDoc],
  store.embeddings,
  config,
);

void addDocsPlain;
void addVectorsPlain;
void fromDocsPlain;

// New 1.0 config surface: index-creation attributes and the concurrency cap.
const fullConfig: AmazonS3VectorsConfig = {
  ...config,
  encryptionConfiguration: { sseType: 'aws:kms', kmsKeyArn: 'arn:aws:kms:us-east-1:1:key/k' },
  tags: { team: 'search' },
  maxConcurrentBatchCalls: 4,
};
const badEncryption: AmazonS3VectorsConfig = {
  ...config,
  // @ts-expect-error -- sseType is a closed union
  encryptionConfiguration: { sseType: 'rsa' },
};
// @ts-expect-error -- tags values must be strings
const badTags: AmazonS3VectorsConfig = { ...config, tags: { count: 1 } };
void fullConfig;
void badEncryption;
void badTags;

// AWS diagnostics are typed on the error context: the public method, and the
// request that failed as a field of its own.
const ctx: S3VectorsErrorContext = {
  operation: 'addVectors',
  awsCommand: 'PutVectors',
  awsErrorName: 'ThrottlingException',
  httpStatusCode: 429,
  requestId: 'r',
  retryable: true,
  attemptedIds: ['a', 'b'],
  batchSize: 200,
  recordIndex: 4,
  recordId: 'k',
  yielded: 2,
};
// @ts-expect-error -- `operation` is the one field always present
const badCtx: S3VectorsErrorContext = { awsErrorName: 'ThrottlingException' };
// @ts-expect-error -- `awsCommand` is the request's name, never anything but a string
const badCommand: S3VectorsErrorContext = { operation: 'addVectors', awsCommand: 1 };
// Read back as optional: absent on every error that is not a failed request.
const command: string | undefined = ctx.awsCommand;
void ctx;
void badCtx;
void badCommand;
void command;

// The enumeration generators, the retriever's signal field, and the
// (Document | undefined)[] shape of getByIds are all part of the surface.
const enumerated: AsyncGenerator<Document> = store.listDocuments({ pageSize: 10 });
const records: AsyncGenerator<S3VectorsRecord> = store.listVectors();
const byIds: Promise<(Document | undefined)[]> = store.getByIds(['a']);
const retriever: AmazonS3VectorsRetriever = store.asRetriever({
  k: 2,
  signal: new AbortController().signal,
});
const mmr: Promise<Document[]> = store.maxMarginalRelevanceSearch(
  'q',
  { k: 2, fetchK: 4, lambda: 0.5 },
  undefined,
  new AbortController().signal,
);
void enumerated;
void records;
void byIds;
void retriever;
void mmr;

// `delete` removes vectors and requires the ids to remove; destroying the
// index is a separate, named method.
const deleteByIds: Promise<void> = store.delete({ ids: ['a'] });
// @ts-expect-error -- ids is required: delete is not a way to destroy an index
const deleteWithoutIds: Promise<void> = store.delete({});
// @ts-expect-error -- the flag that used to destroy the index is gone
const deleteAllFlag: Promise<void> = store.delete({ ids: ['a'], deleteAll: true });
const dropIndex: Promise<void> = store.deleteIndex({ signal: new AbortController().signal });
void deleteByIds;
void deleteWithoutIds;
void deleteAllFlag;
void dropIndex;

// ─── The metadata type is the same everywhere a document comes out ───────────
//
// `retriever.invoke` declared `DocumentInterface<Record<string, unknown>>[]`
// while `store.similaritySearch` and the inherited `retriever.batch` /
// `retriever.stream` use `@langchain/core`'s default `Record<string, any>`. So
// reading a known field off a result compiled from the store and not from the
// retriever — same documents, same class, and `invoke` disagreeing with
// `batch`. Widening is free; narrowing later would not be, so it is settled
// here rather than after the surface freezes.
const retrieverForMetadata = store.asRetriever({ k: 2 });

async function metadataIsReadableFromEveryEntryPoint(): Promise<void> {
  const fromStore = await store.similaritySearch('q', 1);
  const fromInvoke = await retrieverForMetadata.invoke('q');
  const fromBatch = await retrieverForMetadata.batch(['q']);

  const a: string = fromStore[0]!.metadata['genre'];
  const b: string = fromInvoke[0]!.metadata['genre'];
  const c: string = fromBatch[0]![0]!.metadata['genre'];
  void a;
  void b;
  void c;
}
void metadataIsReadableFromEveryEntryPoint;

// ─── The type-only exports are pinned too ───────────────────────────────────
//
// The runtime export set is asserted exactly in index-exports.test.ts; the
// type-only half had no such pin, so removing one from `src/index.ts` failed
// nothing. Naming each one here makes a removal a compile error, which is what
// "a minor may add but only a major may remove" needs in order to mean
// anything for the types.
import type {
  AmazonS3VectorsConfig as _Config,
  AmazonS3VectorsRetrieverFields as _RetrieverFields,
  AmazonS3VectorsRetrieverInput as _RetrieverInput,
  DistanceMetric as _DistanceMetric,
  S3OutputVector as _OutputVector,
  S3VectorsAddOptions as _AddOptions,
  S3VectorsDeleteIndexOptions as _DeleteIndexOptions,
  S3VectorsDeleteOptions as _DeleteOptions,
  S3VectorsErrorContext as _ErrorContext,
  S3VectorsFactoryConfig as _FactoryConfig,
  S3VectorsGetByIdsOptions as _GetByIdsOptions,
  S3VectorsListOptions as _ListOptions,
  S3VectorsRecord as _Record,
  VectorDataType as _VectorDataType,
} from '../../src/index.js';

type _PinnedTypeExports = [
  _Config,
  _RetrieverFields,
  _RetrieverInput,
  _DistanceMetric,
  _OutputVector,
  _AddOptions,
  _DeleteIndexOptions,
  _DeleteOptions,
  _ErrorContext,
  _FactoryConfig,
  _GetByIdsOptions,
  _ListOptions,
  _Record,
  _VectorDataType,
];
declare const _pinned: _PinnedTypeExports;
void _pinned;

// The id arrays in a failure's context are readonly all the way down, not just
// the properties holding them. Tightening this after 1.0 would be breaking, so
// it is settled here.
declare const failure: _ErrorContext;
// @ts-expect-error -- writtenIds is a readonly array: push is not available
failure.writtenIds?.push('x');
const writtenIdsAreReadable: readonly string[] | undefined = failure.writtenIds;
void writtenIdsAreReadable;
