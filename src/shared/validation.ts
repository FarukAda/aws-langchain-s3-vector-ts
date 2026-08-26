import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

const BUCKET_NAME_MIN_LENGTH = 3;
const BUCKET_NAME_MAX_LENGTH = 63;
// AWS: lowercase letters, numbers, and hyphens only — no dots (unlike index names).
const BUCKET_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const INDEX_NAME_MIN_LENGTH = 3;
const INDEX_NAME_MAX_LENGTH = 63;
const INDEX_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function fail(message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation: 'constructor' });
}

/**
 * Validate bucket and index names before any AWS call.
 *
 * @remarks
 * Mirrors AWS's own documented naming rules for both
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-buckets-naming.html)
 * so a malformed name fails fast and locally instead of surfacing as an
 * opaque AWS `ValidationException` on the first real API call.
 */
export function assertValidIndexConfig(vectorBucketName: string, indexName: string): void {
  if (
    vectorBucketName.length < BUCKET_NAME_MIN_LENGTH ||
    vectorBucketName.length > BUCKET_NAME_MAX_LENGTH
  ) {
    fail(`vectorBucketName must be ${BUCKET_NAME_MIN_LENGTH}–${BUCKET_NAME_MAX_LENGTH} characters`);
  }
  if (!BUCKET_NAME_PATTERN.test(vectorBucketName)) {
    fail('vectorBucketName must contain only lowercase letters, numbers, and hyphens');
  }
  if (indexName.length < INDEX_NAME_MIN_LENGTH || indexName.length > INDEX_NAME_MAX_LENGTH) {
    fail(`indexName must be ${INDEX_NAME_MIN_LENGTH}–${INDEX_NAME_MAX_LENGTH} characters`);
  }
  if (!INDEX_NAME_PATTERN.test(indexName)) {
    fail('indexName must contain only lowercase letters, numbers, hyphens, and dots');
  }
}
