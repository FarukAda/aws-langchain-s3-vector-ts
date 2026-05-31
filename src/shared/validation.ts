import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

const INDEX_NAME_MIN_LENGTH = 3;
const INDEX_NAME_MAX_LENGTH = 63;
const INDEX_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function fail(message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation: 'constructor' });
}

/** Validate bucket and index names before any AWS call. */
export function assertValidIndexConfig(vectorBucketName: string, indexName: string): void {
  if (!vectorBucketName) fail('vectorBucketName must be a non-empty string');
  if (indexName.length < INDEX_NAME_MIN_LENGTH || indexName.length > INDEX_NAME_MAX_LENGTH) {
    fail(`indexName must be ${INDEX_NAME_MIN_LENGTH}–${INDEX_NAME_MAX_LENGTH} characters`);
  }
  if (!INDEX_NAME_PATTERN.test(indexName)) {
    fail('indexName must contain only lowercase letters, numbers, hyphens, and dots');
  }
}
