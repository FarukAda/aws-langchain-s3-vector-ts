import type { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../../src/index.js';
import type { AmazonS3VectorsConfig, DistanceMetric } from '../../src/index.js';

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
