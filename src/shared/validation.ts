/**
 * Hides what a valid store is.
 *
 * Every configuration value is checked once, when the store is constructed, so
 * that no later operation has to wonder. The decision hidden here is that the
 * whole configuration is settled up front and refuses to start rather than
 * failing at the first request — including the near-miss check, which refuses a
 * misspelled option rather than silently using the default.
 */
import { DataType, DistanceMetric, S3VectorsClient, SseType } from '@aws-sdk/client-s3vectors';

import type { AmazonS3VectorsConfig } from '../types.js';
import {
  isTagKeyLength,
  isTagValueLength,
  METADATA_KEY_MAX_LENGTH,
  METADATA_KEY_MIN_LENGTH,
  TAG_KEY_MAX_LENGTH,
  TAG_KEY_MIN_LENGTH,
  TAG_VALUE_MAX_LENGTH,
} from './aws-limits.js';
import { describeValue } from './describe.js';
import { S3VectorsErrorCode } from './errors/error-code.js';
import { S3VectorsError } from './errors/s3-vectors-error.js';
import { isObjectLike } from './objects.js';
import type { StoreScope } from './scope.js';
import { unpairedSurrogateReason } from './utf16.js';

const BUCKET_NAME_MIN_LENGTH = 3;
const BUCKET_NAME_MAX_LENGTH = 63;
// AWS: lowercase letters, numbers, and hyphens only — no dots (unlike index names).
const BUCKET_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const INDEX_NAME_MIN_LENGTH = 3;
const INDEX_NAME_MAX_LENGTH = 63;
const INDEX_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/**
 * Raise a `VALIDATION` against the constructor, the only caller here — naming
 * the bucket and index when the check runs after they were validated, and
 * neither before, when neither is known to be one.
 */
function fail(message: string, scope?: StoreScope): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
    operation: 'constructor',
    ...scope,
  });
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

/**
 * The options an explicitly supplied `client` would otherwise decide silently:
 * each one configures the client this store would have built, and a
 * caller-supplied client was built with its own.
 */
const CLIENT_EXCLUSIVE_OPTIONS = [
  'region',
  'credentials',
  'endpoint',
  'maxAttempts',
  'retryMode',
  'connectionTimeout',
  'socketTimeout',
  'requestTimeout',
] as const;

/**
 * Retry modes the SDK accepts. `S3VectorsClientConfig` types `retryMode` as a
 * bare `string`, so there is no enum object to check against the way
 * `DistanceMetric` and `DataType` are — these are the two the SDK's own
 * `RETRY_MODES` enum defines, and the set `AmazonS3VectorsConfig` declares.
 * `test/contract/dependency-citations.test.ts` reads that enum out of the
 * installed SDK and holds this list to it.
 *
 * `'legacy'` was a third member from 0.9.0. The SDK never had one: its retry
 * middleware asks only whether the mode is `adaptive`, so `'legacy'` ran
 * `standard` — an option read as its default with nothing said, which is what
 * this validation exists to refuse.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-smithy-util-retry/Enum/RETRY_MODES/
 */
const RETRY_MODES = ['standard', 'adaptive'] as const;

/**
 * Connection-phase ceiling for a client this store builds. Generous: it bounds
 * establishing a TCP connection, not the work that follows.
 */
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Idle-socket ceiling for a client this store builds.
 *
 * Idle, not total: a request still transferring never trips it, so a large
 * batch is safe, while an endpoint that accepts the connection and then says
 * nothing is ended rather than waited on forever.
 */
const DEFAULT_SOCKET_TIMEOUT_MS = 60_000;

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

/**
 * `region`: a non-empty string.
 *
 * @throws {S3VectorsError} `VALIDATION`. An empty string, a number or `null`
 * otherwise reaches the SDK, which raises its own uncoded
 * `Error("Region is missing")` from inside the first request.
 */
function assertRegion(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`config.region must be a non-empty string (received ${describeOption(value)}).`);
  }
}

/**
 * `endpoint`: an absolute URL.
 *
 * @throws {S3VectorsError} `VALIDATION`. A string that is not a URL is taken by
 * the SDK and fails per request, far from the mistake that caused it.
 */
function assertEndpoint(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !URL.canParse(value)) {
    fail(
      'config.endpoint must be an absolute URL string such as ' +
        `"https://s3vectors.us-east-1.amazonaws.com" (received ${describeOption(value)}).`,
    );
  }
}

/**
 * `credentials`: a static credential pair, or a provider returning one.
 *
 * @throws {S3VectorsError} `VALIDATION`, describing the value by kind only.
 * This is the one option whose content is a secret, so the message never
 * echoes it.
 */
function assertCredentials(value: unknown): void {
  if (value === undefined || typeof value === 'function') return;
  const pair = isObjectLike(value) ? value : undefined;
  if (
    pair === undefined ||
    typeof pair['accessKeyId'] !== 'string' ||
    typeof pair['secretAccessKey'] !== 'string'
  ) {
    fail(
      'config.credentials must be an object with string `accessKeyId` and `secretAccessKey`, ' +
        `or a function returning one (received ${describeValue(value)}).`,
    );
  }
}

/**
 * `maxAttempts`: an integer of 1 or more.
 *
 * @throws {S3VectorsError} `VALIDATION`. `0` and `-1` are silently taken by the
 * SDK as a single attempt and a string as the default three, so a caller asking
 * for more retries could quietly get fewer.
 */
function assertMaxAttempts(value: unknown): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 1) {
    fail(
      `config.maxAttempts must be an integer of 1 or more (received ${describeOption(value)}). ` +
        '1 means a single attempt with no retries.',
    );
  }
}

/**
 * A millisecond timeout: a non-negative integer, `0` disabling it.
 *
 * @throws {S3VectorsError} `VALIDATION`.
 */
function assertTimeoutOption(value: unknown, option: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 0) {
    fail(
      `config.${option} must be a non-negative integer number of milliseconds ` +
        `(received ${describeOption(value)}). Use 0 to disable it.`,
    );
  }
}

/**
 * `maxConcurrentBatchCalls`: an integer of 1 or more.
 *
 * @throws {S3VectorsError} `VALIDATION`. It is the size of the window every
 * batched operation runs in, so it is a count of requests in flight: `0`, a
 * negative number and a fraction have no meaning as one, and a string read out
 * of an environment variable is not a number at all.
 */
function assertConcurrency(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(
      `config.maxConcurrentBatchCalls must be a positive integer (received ${describeValue(value)}).`,
    );
  }
}

/**
 * A boolean option, checked rather than coerced.
 *
 * @throws {S3VectorsError} `VALIDATION`. The case that matters is a config
 * assembled from environment variables, where every non-empty string is truthy:
 * `createIndexIfNotExist: 'false'` read as "yes, create it", and created it.
 */
function assertBooleanOption(value: unknown, option: string): void {
  if (value === undefined) return;
  if (typeof value !== 'boolean') {
    fail(
      `config.${option} must be a boolean (received ${describeOption(value)}). ` +
        "A string is not coerced: 'false' read from an environment variable is truthy and " +
        'would mean the opposite of what it says.',
    );
  }
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
 * A key that is not well-formed UTF-16 is refused too: every write carries it
 * as a metadata key, and S3 Vectors fails any request containing one
 * (docs/evidence/string-encoding.md, T3-15).
 */
function assertPageContentKey(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    fail(
      'config.pageContentMetadataKey must be a string or null (received ' +
        `${describeValue(value)}). Use null to keep page content out of metadata.`,
    );
  }
  if (value.length < METADATA_KEY_MIN_LENGTH || value.length > METADATA_KEY_MAX_LENGTH) {
    fail(
      `config.pageContentMetadataKey must be ${METADATA_KEY_MIN_LENGTH}–${METADATA_KEY_MAX_LENGTH} ` +
        `characters (received ${value.length}).`,
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
  const reason = unpairedSurrogateReason(value);
  if (reason !== undefined) fail(`config.pageContentMetadataKey ${reason}.`);
}

/**
 * `nonFilterableMetadataKeys`: an array of well-formed strings.
 *
 * @throws {S3VectorsError} `VALIDATION`. Unchecked, a non-array is spread into
 * `CreateIndex` and fails as a raw `TypeError`, and a key that is not well-formed
 * UTF-16 fails `CreateIndex` with `SerializationException` (T3-15).
 */
function assertNonFilterableKeys(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail(
      'config.nonFilterableMetadataKeys must be an array of strings (received ' +
        `${describeValue(value)}).`,
    );
  }
  const keys = value as unknown[];
  for (let index = 0; index < keys.length; index++) {
    const key: unknown = keys[index];
    if (typeof key !== 'string') {
      fail(
        'config.nonFilterableMetadataKeys must contain only strings (received ' +
          `${describeValue(key)}).`,
      );
    }
    const reason = unpairedSurrogateReason(key);
    if (reason !== undefined) fail(`config.nonFilterableMetadataKeys[${index}] ${reason}.`);
  }
}

/**
 * Refuse construction for a `nonFilterableMetadataKeys` list no index could be
 * created with, naming the option.
 *
 * Accepts: `pageContentMetadataKey` as resolved (never `undefined`); the
 * bucket and index, already validated by the time this rule runs; and
 * `message`, the text {@link assertMetadataKeysCreatable} raised. It is passed as that
 * rule's `fail`, over the list merged with the page-content key, so the
 * decision stays in one place and this only says where the list came from.
 *
 * Returns: never.
 *
 * @throws {S3VectorsError} `VALIDATION` naming `config.nonFilterableMetadataKeys`,
 * the way every other construction error names its option, and the
 * page-content key merged into it when one is configured — the list checked is
 * that merge, not the configured list alone. Its context carries the bucket
 * and index, as {@link resolveClient}'s does.
 */
export function failNonFilterableKeys(
  pageContentMetadataKey: string | null,
  scope: StoreScope,
  message: string,
): never {
  const merged =
    pageContentMetadataKey === null
      ? ''
      : ` (merged with the page-content key ${JSON.stringify(pageContentMetadataKey)})`;
  fail(`config.nonFilterableMetadataKeys${merged}: ${message}`, scope);
}

/**
 * `writeRateLimit`: `false`, or an object of positive, finite rates.
 *
 * @throws {S3VectorsError} `VALIDATION`. A rate of `0` would stop every write
 * for ever and a negative or non-finite one has no meaning, so neither is read
 * as "no limit" — that is what `false` says.
 */
function assertWriteRateLimit(value: unknown): void {
  if (value === undefined || value === false) return;
  if (!isObjectLike(value)) {
    fail(
      'config.writeRateLimit must be an object of rates, or false to turn pacing off ' +
        `(received ${describeValue(value)}).`,
    );
  }
  for (const option of ['vectorsPerSecond', 'requestsPerSecond'] as const) {
    const rate: unknown = value[option];
    if (rate === undefined) continue;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      fail(
        `config.writeRateLimit.${option} must be a positive, finite number of ` +
          `${option === 'vectorsPerSecond' ? 'vectors' : 'requests'} per second ` +
          `(received ${describeOption(rate)}). Use false to turn pacing off.`,
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
 * `tags`: well-formed string keys of 1–128 characters, well-formed string
 * values of at most 256.
 *
 * @throws {S3VectorsError} `VALIDATION`. The bounds are `CreateIndex`'s own
 * (API reference `API_S3VectorBuckets_CreateIndex.html`). A string that is not
 * well-formed UTF-16 fails CreateIndex with SerializationException (T3-15).
 */
function assertTags(value: unknown): void {
  if (value === undefined) return;
  if (!isObjectLike(value)) {
    fail(
      `config.tags must be an object of string keys and values (received ${describeValue(value)}).`,
    );
  }
  for (const [key, tagValue] of Object.entries(value)) {
    if (!isTagKeyLength(key)) {
      fail(
        `config.tags keys must be ${TAG_KEY_MIN_LENGTH}–${TAG_KEY_MAX_LENGTH} characters ` +
          `(received ${key.length}).`,
      );
    }
    const keyReason = unpairedSurrogateReason(key);
    if (keyReason !== undefined) fail(`config.tags has a key that ${keyReason}.`);
    if (typeof tagValue !== 'string') {
      fail(`config.tags["${key}"] must be a string (received ${describeValue(tagValue)}).`);
    }
    if (!isTagValueLength(tagValue)) {
      fail(
        `config.tags["${key}"] must be at most ${TAG_VALUE_MAX_LENGTH} characters ` +
          `(received ${tagValue.length}).`,
      );
    }
    const valueReason = unpairedSurrogateReason(tagValue);
    if (valueReason !== undefined) fail(`config.tags["${key}"] ${valueReason}.`);
  }
}

/**
 * `encryptionConfiguration`: an object whose `sseType` the service defines,
 * whose `kmsKeyArn` is a well-formed string when present, and whose two fields
 * are paired the way `CreateIndex` requires.
 *
 * @throws {S3VectorsError} `VALIDATION`. A `kmsKeyArn` that is not well-formed
 * UTF-16 fails `CreateIndex` with `SerializationException` (T3-15). The pairing
 * is AWS's own, in both directions, measured against the live service
 * (`docs/evidence/index-encryption.md`): a key with `AES256` — or with no
 * `sseType`, which the service reads as `AES256` — is refused with "kmsKeyArn
 * must not be specified when sseType is AES256.", and `aws:kms` without a key
 * with "kmsKeyArn must be specified when sseType is set to aws:kms". The API
 * reference states neither: it marks `kmsKeyArn` as not required and says only
 * that it is allowed if and only if `sseType` is `aws:kms`. Both refusals
 * otherwise arrive at the first write, after its batch has been embedded.
 */
function assertEncryption(value: unknown): void {
  if (value === undefined) return;
  if (!isObjectLike(value)) {
    fail(`config.encryptionConfiguration must be an object (received ${describeValue(value)}).`);
  }
  assertEnumMember(value['sseType'], Object.values(SseType), 'encryptionConfiguration.sseType');
  const sseType: unknown = value['sseType'];
  const kmsKeyArn: unknown = value['kmsKeyArn'];
  if (kmsKeyArn === undefined) {
    if (sseType === SseType.AWS_KMS) {
      fail(
        'config.encryptionConfiguration: kmsKeyArn must be specified when sseType is set to ' +
          'aws:kms. AWS refuses the index creation otherwise; there is no default key.',
      );
    }
    return;
  }
  if (sseType !== SseType.AWS_KMS) {
    fail(
      'config.encryptionConfiguration: kmsKeyArn must not be specified when sseType is AES256 ' +
        `(received sseType ${sseType === undefined ? 'unset, which AWS reads as AES256' : describeOption(sseType)}). ` +
        'Set sseType to "aws:kms" to use your key, or drop kmsKeyArn to use S3-managed keys.',
    );
  }
  if (typeof kmsKeyArn !== 'string') {
    fail(
      'config.encryptionConfiguration.kmsKeyArn must be a string (received ' +
        `${describeValue(kmsKeyArn)}).`,
    );
  }
  const reason = unpairedSurrogateReason(kmsKeyArn);
  if (reason !== undefined) fail(`config.encryptionConfiguration.kmsKeyArn ${reason}.`);
}

/**
 * `client` is exclusive with every option in {@link CLIENT_EXCLUSIVE_OPTIONS},
 * each of which configures the client this store would otherwise build.
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
 * Every option the store itself reads, by name.
 *
 * Exported for the static factories, which have to hand the constructor a copy
 * of the configuration without the write options in it — and a copy made by
 * spreading holds own enumerable properties only. An option behind an accessor
 * or on a prototype is read by name, as the constructor reads it, and this is
 * the list of names.
 */
export const STORE_CONFIG_KEYS = [
  'vectorBucketName',
  'indexName',
  'dataType',
  'distanceMetric',
  'nonFilterableMetadataKeys',
  'pageContentMetadataKey',
  'createIndexIfNotExist',
  'encryptionConfiguration',
  'tags',
  'maxConcurrentBatchCalls',
  'writeRateLimit',
  'relevanceScoreFn',
  'embeddings',
  'queryEmbeddings',
  'client',
  'region',
  'credentials',
  'endpoint',
  'maxAttempts',
  'retryMode',
  'connectionTimeout',
  'socketTimeout',
  'requestTimeout',
] as const satisfies readonly (keyof AmazonS3VectorsConfig)[];

/**
 * Every key a store configuration may carry: the options themselves, plus the
 * three write options the static factories take in the same object.
 */
const KNOWN_CONFIG_KEYS: readonly string[] = [...STORE_CONFIG_KEYS, 'ids', 'batchSize', 'signal'];

/** Shortest edit distance between two keys, capped at 3 because nothing further matters. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The option an unknown key was probably meant to be, or `undefined`.
 *
 * A key is a near miss when it differs only in case, or — from six characters
 * up — when it is within two edits of an option or is the start of one. Below
 * that the rule stays silent: `k` is three edits from `ids`, and short keys
 * belong to callers.
 *
 * The margin is measured, not guessed. Of the keys `@langchain/core` and
 * `@langchain/classic` put beside a store config — `k`, `filter`,
 * `exampleKeys`, `inputKeys`, `vectorStore`, `cleanup`, `sourceIdKey`,
 * `searchType`, `minSimilarityScore` — the closest to any option here is
 * `cleanup`, four edits from `client`. Every realistic misspelling is within
 * two, or is a truncation.
 */
function optionMeantBy(key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const option of KNOWN_CONFIG_KEYS) {
    if (option.toLowerCase() === lower) return option;
  }
  if (key.length < 6) return undefined;
  for (const option of KNOWN_CONFIG_KEYS) {
    if (option.toLowerCase().startsWith(lower) || editDistance(lower, option.toLowerCase()) <= 2) {
      return option;
    }
  }
  return undefined;
}

/**
 * Refuse a key that is one typo away from an option, and ignore the rest.
 *
 * @throws {S3VectorsError} `VALIDATION` naming both the key and the option it
 * resembles. An unknown key cannot simply be refused: `@langchain/core`'s
 * `SemanticSimilarityExampleSelector` passes its own `k`, `filter`,
 * `exampleKeys` and `inputKeys` through `fromTexts` in the same object
 * (`@langchain/core@1.2.11` `dist/example_selectors/semantic_similarity.js:106`),
 * and refusing those would break that selector with this store. A near miss is
 * different: nothing else means it, and the cost of reading it as unset is
 * silence — `createIndexIfNotExists` created an index with every default, which
 * an index's immutable configuration then makes permanent.
 */
function assertNoMisspeltOption(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (KNOWN_CONFIG_KEYS.includes(key)) continue;
    const meant = optionMeantBy(key);
    if (meant !== undefined) {
      fail(
        `config.${key} is not an option — did you mean config.${meant}? An option this ` +
          'package does not recognise would be read as unset, and an index created from a ' +
          'configuration cannot be reconfigured afterwards.',
      );
    }
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
  if (!isObjectLike(config)) {
    fail(
      `The store configuration must be an object (received ${describeValue(config)}). ` +
        'It must name at least `vectorBucketName` and `indexName`.',
    );
  }
  assertNoMisspeltOption(config);
  assertEnumMember(config.distanceMetric, Object.values(DistanceMetric), 'distanceMetric');
  assertEnumMember(config.dataType, Object.values(DataType), 'dataType');
  assertPageContentKey(config.pageContentMetadataKey);
  assertNonFilterableKeys(config.nonFilterableMetadataKeys);
  assertRelevanceScoreFn(config.relevanceScoreFn);
  assertWriteRateLimit(config.writeRateLimit);
  assertTags(config.tags);
  assertEncryption(config.encryptionConfiguration);
  assertRegion(config.region);
  assertEndpoint(config.endpoint);
  assertCredentials(config.credentials);
  assertMaxAttempts(config.maxAttempts);
  assertEnumMember(config.retryMode, RETRY_MODES, 'retryMode');
  assertTimeoutOption(config.connectionTimeout, 'connectionTimeout');
  assertTimeoutOption(config.socketTimeout, 'socketTimeout');
  assertTimeoutOption(config.requestTimeout, 'requestTimeout');
  assertBooleanOption(config.createIndexIfNotExist, 'createIndexIfNotExist');
  assertConcurrency(config.maxConcurrentBatchCalls);
  assertClientExclusivity(config);
}

/**
 * The client this store will use: the caller's, or one built from the config.
 *
 * Accepts: the configuration, and the scope for any error.
 *
 * Returns: `config.client` when one was supplied, otherwise a new
 * `S3VectorsClient` built from `region`, `credentials`, `endpoint`,
 * `maxAttempts` and `retryMode`, with `connectionTimeout`, `socketTimeout` and
 * `requestTimeout` applied to its request handler — every option this package
 * passes through. Anything else an `S3VectorsClientConfig` accepts (a custom
 * request handler, a logger, a proxy) needs a caller-built client.
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
      // Each omitted when absent rather than handed an explicit `undefined`: the
      // SDK's own config types these as optional but not `undefined`-valued, and
      // passing undefined is not the same as letting the SDK apply its default.
      ...(config.region === undefined ? {} : { region: config.region }),
      ...(config.credentials === undefined ? {} : { credentials: config.credentials }),
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
      ...(config.retryMode === undefined ? {} : { retryMode: config.retryMode }),
      // A plain options object rather than a constructed handler: the SDK
      // accepts `NodeHttpHandlerOptions` here and builds the handler itself, so
      // this package keeps its zero runtime dependencies instead of taking one
      // on `@smithy/node-http-handler` for three numbers.
      requestHandler: {
        connectionTimeout: config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS,
        socketTimeout: config.socketTimeout ?? DEFAULT_SOCKET_TIMEOUT_MS,
        // Paired, always. Alone, `requestTimeout` only logs a warning and lets
        // the request continue, so a caller who set it would believe they had a
        // deadline and would not have one.
        ...(config.requestTimeout === undefined
          ? {}
          : { requestTimeout: config.requestTimeout, throwOnRequestTimeout: true }),
      },
    })
  );
}
