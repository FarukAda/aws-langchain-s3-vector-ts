import type { Document, DocumentInterface } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/index.js';
import type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  S3VectorsErrorContext,
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

// similaritySearchWithRelevanceScores accepts an AbortSignal in either the
// historical 4th slot or the 5th slot its text-based siblings use, so
// realigning the parameter order broke no existing caller.
const relevanceAbortLegacy: Promise<[Document, number][]> =
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

// AWS diagnostics are typed on the error context.
const ctx: S3VectorsErrorContext = {
  operation: 'PutVectors',
  awsErrorName: 'ThrottlingException',
  httpStatusCode: 429,
  requestId: 'r',
  retryable: true,
  indexCacheInvalidated: true,
};
// @ts-expect-error -- indexCacheInvalidated is only ever `true`, never `false`
const badCtx: S3VectorsErrorContext = { operation: 'x', indexCacheInvalidated: false };
void ctx;
void badCtx;
