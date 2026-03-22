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

export { cosineRelevanceScoreFn, euclideanRelevanceScoreFn } from './utils.js';
