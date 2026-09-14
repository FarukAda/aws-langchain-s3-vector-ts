import { DataType, DistanceMetric, SseType } from '@aws-sdk/client-s3vectors';

import type { AmazonS3VectorsConfig } from '../types.js';
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
  // Checked before any `.length`: an untyped caller reading either name out of
  // an environment map can hand us a number, null or undefined, and reading a
  // property off that is a raw, uncoded TypeError.
  for (const [option, value] of [
    ['vectorBucketName', vectorBucketName],
    ['indexName', indexName],
  ] as const) {
    if (typeof value !== 'string') {
      fail(`${option} must be a string (received ${describeType(value)}).`);
    }
  }
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

/** What a value is, for a message, without printing the value itself. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** The metadata key length AWS documents for an index (userguide `s3-vectors-indexes.html`). */
const METADATA_KEY_MAX_LENGTH = 63;
/** Tag bounds from the `CreateIndex` API reference: keys 1–128 characters, values 0–256. */
const TAG_KEY_MAX_LENGTH = 128;
const TAG_VALUE_MAX_LENGTH = 256;

/**
 * The five options an explicitly supplied `client` would otherwise decide
 * silently: each one is a constructor argument to the client this store would
 * have built, and a caller-supplied client was built with its own.
 */
const CLIENT_EXCLUSIVE_OPTIONS = [
  'region',
  'credentials',
  'endpoint',
  'maxAttempts',
  'retryMode',
] as const;

/** `"a", "b"`, built from the SDK's own enum object rather than a copy of it. */
function oneOf(allowed: readonly string[]): string {
  return allowed.map((value) => `"${value}"`).join(', ');
}

/** A value for a message: a string as itself, anything else by type alone. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : describeType(value);
}

function assertEnumMember(value: unknown, allowed: readonly string[], option: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(`config.${option} must be one of ${oneOf(allowed)} (received ${describeValue(value)}).`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the store configuration before anything is built from it.
 *
 * @remarks
 * Every option here is reachable from an untyped caller, a cast, or a config
 * assembled at runtime from environment variables. Each closed-set option is
 * checked against the SDK's own enum object — not a copy of its members — so
 * the check cannot drift from the service model. Each shape check replaces a
 * failure that would otherwise arrive as an AWS round trip, or, worse, as an
 * uncoded `TypeError` thrown from inside a later search.
 *
 * Supplying `client` alongside `region`, `credentials`, `endpoint`,
 * `maxAttempts` or `retryMode` is rejected rather than silently resolved in the
 * client's favour: a caller who passes their own client *and* `maxAttempts: 5`
 * would otherwise get the client's retry policy with nothing said, which is the
 * same class of surprise as a signal handed to the callbacks slot.
 *
 * @param config - The configuration as given, before any default is applied
 * @throws {S3VectorsError} `VALIDATION`, naming the option and the rule. The
 * message never echoes credential material.
 */
export function assertValidConfig(config: AmazonS3VectorsConfig): void {
  assertEnumMember(config.distanceMetric, Object.values(DistanceMetric), 'distanceMetric');
  assertEnumMember(config.dataType, Object.values(DataType), 'dataType');

  const pageContentKey: unknown = config.pageContentMetadataKey;
  if (pageContentKey !== undefined && pageContentKey !== null) {
    if (typeof pageContentKey !== 'string') {
      fail(
        'config.pageContentMetadataKey must be a string or null (received ' +
          `${describeType(pageContentKey)}). Use null to keep page content out of metadata.`,
      );
    }
    if (pageContentKey.length < 1 || pageContentKey.length > METADATA_KEY_MAX_LENGTH) {
      fail(
        `config.pageContentMetadataKey must be 1–${METADATA_KEY_MAX_LENGTH} characters ` +
          `(received ${pageContentKey.length}).`,
      );
    }
  }

  const nonFilterable: unknown = config.nonFilterableMetadataKeys;
  if (nonFilterable !== undefined) {
    if (!Array.isArray(nonFilterable)) {
      fail(
        'config.nonFilterableMetadataKeys must be an array of strings (received ' +
          `${describeType(nonFilterable)}).`,
      );
    }
    for (const key of nonFilterable as unknown[]) {
      if (typeof key !== 'string') {
        fail(
          'config.nonFilterableMetadataKeys must contain only strings (received ' +
            `${describeType(key)}).`,
        );
      }
    }
  }

  const relevanceScoreFn: unknown = config.relevanceScoreFn;
  if (relevanceScoreFn !== undefined && typeof relevanceScoreFn !== 'function') {
    fail(
      `config.relevanceScoreFn must be a function (received ${describeType(relevanceScoreFn)}). ` +
        'It is called for every search result, so a wrong shape here fails inside a search ' +
        'rather than at construction.',
    );
  }

  const tags: unknown = config.tags;
  if (tags !== undefined) {
    if (!isPlainObject(tags)) {
      fail(
        'config.tags must be an object of string keys and values (received ' +
          `${describeType(tags)}).`,
      );
    }
    for (const [key, value] of Object.entries(tags)) {
      if (key.length < 1 || key.length > TAG_KEY_MAX_LENGTH) {
        fail(
          `config.tags keys must be 1–${TAG_KEY_MAX_LENGTH} characters (received ${key.length}).`,
        );
      }
      if (typeof value !== 'string') {
        fail(`config.tags["${key}"] must be a string (received ${describeType(value)}).`);
      }
      if (value.length > TAG_VALUE_MAX_LENGTH) {
        fail(
          `config.tags["${key}"] must be at most ${TAG_VALUE_MAX_LENGTH} characters ` +
            `(received ${value.length}).`,
        );
      }
    }
  }

  const encryption: unknown = config.encryptionConfiguration;
  if (encryption !== undefined) {
    if (!isPlainObject(encryption)) {
      fail(
        `config.encryptionConfiguration must be an object (received ${describeType(encryption)}).`,
      );
    }
    assertEnumMember(
      encryption['sseType'],
      Object.values(SseType),
      'encryptionConfiguration.sseType',
    );
  }

  if (config.client !== undefined && config.client !== null) {
    const supplied = CLIENT_EXCLUSIVE_OPTIONS.filter((option) => config[option] !== undefined);
    if (supplied.length > 0) {
      const names = supplied.map((option) => `config.${option}`).join(', ');
      fail(
        `config.client was supplied together with ${names}, which configure the client this ` +
          'store would otherwise build. A supplied client carries its own, so those settings ' +
          'would be silently ignored. Pass one or the other.',
      );
    }
  }
}
