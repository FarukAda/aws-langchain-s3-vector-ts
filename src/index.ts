/**
 * LangChain-compatible Amazon S3 Vectors store for TypeScript.
 *
 * @packageDocumentation
 */

export { AmazonS3Vectors } from './s3-vectors.js';

export type {
  AmazonS3VectorsConfig,
  DistanceMetric,
  VectorDataType,
  S3VectorsDeleteParams,
  S3OutputVector,
} from './types.js';

export { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './relevance-scores.js';

export { S3VectorsError, isS3VectorsError } from './shared/errors/s3-vectors-error.js';
export type { S3VectorsErrorContext } from './shared/errors/s3-vectors-error.js';
export { S3VectorsErrorCode } from './shared/errors/error-code.js';
