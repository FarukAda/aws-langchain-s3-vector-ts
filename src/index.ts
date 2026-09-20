/**
 * LangChain-compatible Amazon S3 Vectors store for TypeScript.
 *
 * Hides where anything lives.
 *
 * This module re-exports and declares nothing of its own, so the internal
 * arrangement — which module holds the store, the retriever, the error class
 * or the metadata helper — is free to change without moving anything a caller
 * imports. What appears here is the whole supported surface; a name reachable
 * by a deep import is not part of it.
 *
 * @packageDocumentation
 */

export { AmazonS3Vectors } from './s3-vectors.js';

export type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  VectorDataType,
  S3VectorsDeleteIndexOptions,
  S3VectorsDeleteOptions,
  S3VectorsListOptions,
  S3VectorsRecord,
  S3OutputVector,
} from './types.js';

export { AmazonS3VectorsRetriever } from './retriever.js';
export type { AmazonS3VectorsRetrieverFields, AmazonS3VectorsRetrieverInput } from './retriever.js';

export { cosineRelevanceScoreFn } from './relevance-scores.js';

export { flattenMetadata } from './shared/flatten-metadata.js';

export { S3VectorsError, isS3VectorsError } from './shared/errors/s3-vectors-error.js';
export type { S3VectorsErrorContext } from './shared/errors/s3-vectors-error.js';
export { S3VectorsErrorCode } from './shared/errors/error-code.js';
