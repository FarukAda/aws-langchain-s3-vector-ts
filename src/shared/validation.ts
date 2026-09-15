import { DataType, DistanceMetric, S3VectorsClient, SseType } from '@aws-sdk/client-s3vectors';

import type { StoreScope } from '../internal/signals.js';
import type { AmazonS3VectorsConfig } from '../types.js';
import { describeValue } from './describe.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';

const BUCKET_NAME_MIN_LENGTH = 3;
const BUCKET_NAME_MAX_LENGTH = 63;
// AWS: lowercase letters, numbers, and hyphens only — no dots (unlike index names).
const BUCKET_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const INDEX_NAME_MIN_LENGTH = 3;
const INDEX_NAME_MAX_LENGTH = 63;
const INDEX_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Raise a `VALIDATION` against the constructor, the only caller here. */
function fail(message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation: 'constructor' });
}

/**
 * Validate the bucket and index names before any AWS call.
 *
 * Accepts: two strings. A non-string is the first thing checked, because
 * everything below reads `.length` and an untyped caller assembling a config
 * from environment variables can hand us `undefined`.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming which of the two failed and the rule it broke.
 *
 * Guarantees: the rules are AWS's own
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-buckets-naming.html)
 * — 3–63 characters, lowercase letters, digits and hyphens, beginning and
 * ending alphanumeric. An index name may additionally contain dots; a bucket
 * name may not. The API reference's ARN pattern permits a dot in the bucket
 * segment, but the user guide's naming rules forbid it, and the stricter of
 * two AWS sources is the safe one to enforce locally.
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
      fail(`${option} must be a string (received ${describeOption(value)}).`);
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

/** A value for a message: a string as itself, anything else by kind alone. */
function describeOption(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : describeValue(value);
}

/** Check one option against the SDK's own enum members, not a copy of them. */
function assertEnumMember(value: unknown, allowed: readonly string[], option: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(`config.${option} must be one of ${oneOf(allowed)} (received ${describeOption(value)}).`);
  }
}

/** A plain object, not an array and not null — the shape an options bag must have. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `pageContentMetadataKey`: `null`, or a metadata key AWS will accept.
 *
 * @throws {S3VectorsError} `VALIDATION`. Only `undefined` takes the default,
 * so `''` would otherwise survive into `CreateIndex` as a zero-length key.
 * `'__proto__'` is refused for a reason no length rule would catch: it is the
 * one key name that is a setter on every plain object rather than a storable
 * property, so page content written under it is discarded in silence — the
 * write succeeds, and every document reads back with an empty `pageContent`.
 */
function assertPageContentKey(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    fail(
      'config.pageContentMetadataKey must be a string or null (received ' +
        `${describeValue(value)}). Use null to keep page content out of metadata.`,
    );
  }
  if (value.length < 1 || value.length > METADATA_KEY_MAX_LENGTH) {
    fail(
      `config.pageContentMetadataKey must be 1–${METADATA_KEY_MAX_LENGTH} characters ` +
        `(received ${value.length}).`,
    );
  }
  if (value === '__proto__') {
    fail(
      "config.pageContentMetadataKey must not be '__proto__': it is an accessor on every " +
        'plain object rather than a storable key, so page content written under it would be ' +
        'discarded without error and every document would read back with an empty ' +
        'pageContent. Choose any other key.',
    );
  }
}

/**
 * `nonFilterableMetadataKeys`: an array of strings.
 *
 * @throws {S3VectorsError} `VALIDATION`. Unchecked, a non-array is spread into
 * `CreateIndex` and fails as a raw `TypeError`.
 */
function assertNonFilterableKeys(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail(
      'config.nonFilterableMetadataKeys must be an array of strings (received ' +
        `${describeValue(value)}).`,
    );
  }
  for (const key of value as unknown[]) {
    if (typeof key !== 'string') {
      fail(
        'config.nonFilterableMetadataKeys must contain only strings (received ' +
          `${describeValue(key)}).`,
      );
    }
  }
}

/**
 * `relevanceScoreFn`: a function.
 *
 * @throws {S3VectorsError} `VALIDATION`. It is called for every search result,
 * so a wrong shape here surfaces as an uncoded `TypeError` from inside a
 * search rather than at construction.
 */
function assertRelevanceScoreFn(value: unknown): void {
  if (value !== undefined && typeof value !== 'function') {
    fail(
      `config.relevanceScoreFn must be a function (received ${describeValue(value)}). ` +
        'It is called for every search result, so a wrong shape here fails inside a search ' +
        'rather than at construction.',
    );
  }
}

/**
 * `tags`: string keys of 1–128 characters, string values of at most 256.
 *
 * @throws {S3VectorsError} `VALIDATION`. The bounds are `CreateIndex`'s own
 * (API reference `API_S3VectorBuckets_CreateIndex.html`).
 */
function assertTags(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail(
      `config.tags must be an object of string keys and values (received ${describeValue(value)}).`,
    );
  }
  for (const [key, tagValue] of Object.entries(value)) {
    if (key.length < 1 || key.length > TAG_KEY_MAX_LENGTH) {
      fail(`config.tags keys must be 1–${TAG_KEY_MAX_LENGTH} characters (received ${key.length}).`);
    }
    if (typeof tagValue !== 'string') {
      fail(`config.tags["${key}"] must be a string (received ${describeValue(tagValue)}).`);
    }
    if (tagValue.length > TAG_VALUE_MAX_LENGTH) {
      fail(
        `config.tags["${key}"] must be at most ${TAG_VALUE_MAX_LENGTH} characters ` +
          `(received ${tagValue.length}).`,
      );
    }
  }
}

/**
 * `encryptionConfiguration`: an object whose `sseType` the service defines.
 *
 * @throws {S3VectorsError} `VALIDATION`.
 */
function assertEncryption(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail(`config.encryptionConfiguration must be an object (received ${describeValue(value)}).`);
  }
  assertEnumMember(value['sseType'], Object.values(SseType), 'encryptionConfiguration.sseType');
}

/**
 * `client` is exclusive with the five options that would configure one.
 *
 * @throws {S3VectorsError} `VALIDATION`, naming every option that conflicts —
 * not just the first, so a caller fixes the call once rather than one option
 * per attempt. The message names options, never their values: `credentials` is
 * one of them.
 */
function assertClientExclusivity(config: AmazonS3VectorsConfig): void {
  if (config.client === undefined || config.client === null) return;
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

/**
 * Validate the store configuration before anything is built from it.
 *
 * Accepts: the configuration as given, before any default is applied.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION`, naming the option and the rule. The message never
 * echoes credential material.
 *
 * Guarantees: every option here is reachable from an untyped caller, a cast,
 * or a config assembled at runtime from environment variables. Each closed-set
 * option is checked against the SDK's own enum object — not a copy of its
 * members — so the check cannot drift from the service model. Each shape check
 * replaces a failure that would otherwise arrive as an AWS round trip, or,
 * worse, as an uncoded `TypeError` thrown from inside a later search.
 *
 * One check per option, in the order the constructor reads them, so a caller
 * fixing one error does not have to guess which check will fire next.
 */
export function assertValidConfig(config: AmazonS3VectorsConfig): void {
  // Before any property of it is read. Every check below dereferences `config`,
  // and a store assembled at runtime from an empty environment hands us
  // `undefined` — which surfaced as a raw TypeError from the first check rather
  // than as this package's own error.
  if (!isPlainObject(config)) {
    fail(
      `The store configuration must be an object (received ${describeValue(config)}). ` +
        'It must name at least `vectorBucketName` and `indexName`.',
    );
  }
  assertEnumMember(config.distanceMetric, Object.values(DistanceMetric), 'distanceMetric');
  assertEnumMember(config.dataType, Object.values(DataType), 'dataType');
  assertPageContentKey(config.pageContentMetadataKey);
  assertNonFilterableKeys(config.nonFilterableMetadataKeys);
  assertRelevanceScoreFn(config.relevanceScoreFn);
  assertTags(config.tags);
  assertEncryption(config.encryptionConfiguration);
  assertClientExclusivity(config);
}

/**
 * The client this store will use: the caller's, or one built from the config.
 *
 * Accepts: the configuration, and the scope for any error.
 *
 * Returns: `config.client` when one was supplied, otherwise a new
 * `S3VectorsClient` built from exactly `region`, `credentials`, `endpoint`,
 * `maxAttempts` and `retryMode` — the five options this package passes
 * through. Anything else an `S3VectorsClientConfig` accepts (a custom request
 * handler, a logger, a proxy) needs a caller-built client.
 *
 * Throws: `VALIDATION` when `client` is present but is not an
 * `S3VectorsClient`. A value check on `config.serviceId`, not `instanceof`:
 * that survives a bundler duplicating the SDK across a module boundary, which
 * would make a legitimate client fail an identity test.
 *
 * Guarantees: `null` is read as "not provided", the same reading a `null`
 * filter gets — a DI framework defaulting an optional field to `null` means
 * absence. A non-nullish value that is not a client is a caller mistake and
 * fails rather than falling back: the fallback builds from the ambient
 * credential chain and default region, so it could silently point the store at
 * a different AWS account.
 */
export function resolveClient(config: AmazonS3VectorsConfig, scope: StoreScope): S3VectorsClient {
  const supplied = config.client ?? undefined;
  if (supplied !== undefined && supplied.config?.serviceId !== 'S3Vectors') {
    throw new S3VectorsError(
      'config.client is not an S3VectorsClient from "@aws-sdk/client-s3vectors" (its ' +
        'config.serviceId is not "S3Vectors"). Pass a real S3VectorsClient, or omit `client` ' +
        'entirely and supply `region`/`credentials`/`endpoint` instead — falling back ' +
        'silently could point this store at a different AWS account or region.',
      S3VectorsErrorCode.VALIDATION,
      { operation: 'constructor', ...scope },
    );
  }
  return (
    supplied ??
    new S3VectorsClient({
      region: config.region,
      credentials: config.credentials,
      endpoint: config.endpoint,
      maxAttempts: config.maxAttempts,
      retryMode: config.retryMode,
    })
  );
}
