import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

/**
 * One test per domain cell of the constructor's configuration validation.
 *
 * Every option here is reachable from an untyped JavaScript caller, from a
 * cast, and from a config assembled at runtime out of environment variables —
 * which is how most of them are actually built. Left unchecked each costs a
 * round trip, or surfaces as an uncoded `TypeError` from inside a later search.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;
/** The message a caller actually reads. Asserted per cell: a code says what
 *  class of thing went wrong, the message is the only thing that says which
 *  option and what to do about it. */
const messageOf = (e: unknown): string => String((e as Error).message);
/** The whole context, so a field missing from it fails the cell. */
const contextOf = (e: unknown): unknown => (e as { context?: unknown }).context;

function build(overrides: Record<string, unknown>): unknown {
  const { client } = createMockClient();
  try {
    return new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      client,
      ...overrides,
    });
  } catch (error: unknown) {
    return error;
  }
}

/** Build without the mock client, for the cells about client-exclusive options. */
function buildWithoutClient(overrides: Record<string, unknown>): unknown {
  try {
    return new AmazonS3Vectors(createMockEmbeddings(), {
      ...BASE_CONFIG,
      ...overrides,
    });
  } catch (error: unknown) {
    return error;
  }
}

describe('distanceMetric', () => {
  it.each(['cosine', 'euclidean'])('accepts the documented metric %s', (distanceMetric) => {
    expect(build({ distanceMetric })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects anything else at construction, not on the first search', () => {
    // `DistanceMetric` is a closed set of two
    // (`@aws-sdk/client-s3vectors@3.1133.0` `dist-types/models/enums.d.ts`).
    // Unchecked, this reaches CreateIndex — and assertMetricMatches then
    // compares an existing index against it and mismatches forever.
    const error = build({ distanceMetric: 'manhattan' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('distanceMetric');
  });
});

describe('dataType', () => {
  it('rejects a non-string, which an untyped caller can still supply', () => {
    const error = build({ dataType: 42 });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe('config.dataType must be one of "float32" (received a number).');
  });

  it('accepts float32, the only member the service defines', () => {
    expect(build({ dataType: 'float32' })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects anything else', () => {
    const error = build({ dataType: 'float64' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe('config.dataType must be one of "float32" (received "float64").');
  });
});

describe('pageContentMetadataKey', () => {
  it('accepts null, which disables the page-content round-trip', () => {
    expect(build({ pageContentMetadataKey: null })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects the empty string rather than creating a zero-length metadata key', () => {
    // Only `undefined` triggers the default, so `''` survives into CreateIndex.
    const error = build({ pageContentMetadataKey: '' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.pageContentMetadataKey must be 1–63 characters (received 0).',
    );
  });

  it('rejects a key longer than the documented 63 characters', () => {
    const error = build({ pageContentMetadataKey: 'k'.repeat(64) });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.pageContentMetadataKey must be 1–63 characters (received 64).',
    );
  });

  it('rejects a non-string, non-null value', () => {
    const error = build({ pageContentMetadataKey: 42 });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The remedy is in the message: `null` is the way to store no page content.
    expect(messageOf(error)).toBe(
      'config.pageContentMetadataKey must be a string or null (received a number). ' +
        'Use null to keep page content out of metadata.',
    );
  });
});

describe('nonFilterableMetadataKeys', () => {
  it('accepts an array of strings', () => {
    expect(build({ nonFilterableMetadataKeys: ['blob'] })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-array instead of throwing a raw TypeError from the spread', () => {
    const error = build({ nonFilterableMetadataKeys: 'blob' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.nonFilterableMetadataKeys must be an array of strings (received a string).',
    );
  });

  it('rejects an entry that is not a string', () => {
    const error = build({ nonFilterableMetadataKeys: ['ok', 7] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.nonFilterableMetadataKeys must contain only strings (received a number).',
    );
  });
});

/**
 * D5: merged with `pageContentMetadataKey`, `nonFilterableMetadataKeys` must
 * fit an index — at most 10 keys, each 1–63 characters. Such a configuration
 * can never be written to any index, so it is refused here, at construction,
 * rather than only once a write first creates the index. It is checked after
 * the bucket and index names, so — like every constructor error raised from
 * that point — it names both.
 */
describe('nonFilterableMetadataKeys, merged with pageContentMetadataKey, must fit an index', () => {
  const NINE_KEYS = Array.from({ length: 9 }, (_, i) => `key_${i}`);
  const TEN_KEYS = Array.from({ length: 10 }, (_, i) => `key_${i}`);
  const ELEVEN_KEYS = Array.from({ length: 11 }, (_, i) => `key_${i}`);

  function buildWithMock(overrides: Record<string, unknown>): {
    result: unknown;
    mock: ReturnType<typeof createMockClient>['mock'];
  } {
    const { client, mock } = createMockClient();
    try {
      const result = new AmazonS3Vectors(createMockEmbeddings(), {
        ...BASE_CONFIG,
        client,
        ...overrides,
      });
      return { result, mock };
    } catch (error: unknown) {
      return { result: error, mock };
    }
  }

  it('refuses 10 configured keys plus the default page-content key, naming both', () => {
    const { result, mock } = buildWithMock({ nonFilterableMetadataKeys: TEN_KEYS });
    expect(codeOf(result)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(result)).toBe(
      'config.nonFilterableMetadataKeys (merged with the page-content key "_page_content"): ' +
        'An index may have at most 10 non-filterable metadata keys; this configuration needs 11.',
    );
    expect(contextOf(result)).toEqual({ operation: 'constructor', ...BASE_CONFIG });
    expect(mock.calls()).toHaveLength(0);
  });

  it('refuses 11 configured keys with pageContentMetadataKey: null', () => {
    const { result, mock } = buildWithMock({
      nonFilterableMetadataKeys: ELEVEN_KEYS,
      pageContentMetadataKey: null,
    });
    expect(codeOf(result)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(result)).toBe(
      'config.nonFilterableMetadataKeys: An index may have at most 10 non-filterable metadata keys; ' +
        'this configuration needs 11.',
    );
    expect(contextOf(result)).toEqual({ operation: 'constructor', ...BASE_CONFIG });
    expect(mock.calls()).toHaveLength(0);
  });

  it('refuses a key of length 0', () => {
    const { result, mock } = buildWithMock({ nonFilterableMetadataKeys: [''] });
    expect(codeOf(result)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(result)).toBe(
      'config.nonFilterableMetadataKeys (merged with the page-content key "_page_content"): ' +
        'Non-filterable metadata key "" must be 1-63 characters.',
    );
    expect(contextOf(result)).toEqual({ operation: 'constructor', ...BASE_CONFIG });
    expect(mock.calls()).toHaveLength(0);
  });

  it('refuses a key of length 64', () => {
    const key = 'x'.repeat(64);
    const { result, mock } = buildWithMock({ nonFilterableMetadataKeys: [key] });
    expect(codeOf(result)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(result)).toBe(
      'config.nonFilterableMetadataKeys (merged with the page-content key "_page_content"): ' +
        `Non-filterable metadata key "${key}" must be 1-63 characters.`,
    );
    expect(contextOf(result)).toEqual({ operation: 'constructor', ...BASE_CONFIG });
    expect(mock.calls()).toHaveLength(0);
  });

  it('accepts 10 keys with pageContentMetadataKey: null', () => {
    expect(
      build({ nonFilterableMetadataKeys: TEN_KEYS, pageContentMetadataKey: null }),
    ).toBeInstanceOf(AmazonS3Vectors);
  });

  it('accepts 9 keys plus the default page-content key', () => {
    expect(build({ nonFilterableMetadataKeys: NINE_KEYS })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('accepts a configured list that already contains the page-content key, de-duplicated', () => {
    expect(build({ nonFilterableMetadataKeys: ['_page_content', ...NINE_KEYS] })).toBeInstanceOf(
      AmazonS3Vectors,
    );
  });
});

describe('relevanceScoreFn', () => {
  it('accepts a function', () => {
    expect(build({ relevanceScoreFn: (d: number) => 1 - d })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-function, which would otherwise fail inside a search', () => {
    const error = build({ relevanceScoreFn: 'nope' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.relevanceScoreFn must be a function (received a string). It is called for every ' +
        'search result, so a wrong shape here fails inside a search rather than at ' +
        'construction.',
    );
  });
});

describe('tags', () => {
  it('accepts string keys and values within the documented bounds', () => {
    expect(build({ tags: { env: 'prod', empty: '' } })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-object', () => {
    const error = build({ tags: ['env', 'prod'] });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.tags must be an object of string keys and values (received an array).',
    );
  });

  it('rejects a key longer than 128 characters', () => {
    const error = build({ tags: { ['k'.repeat(129)]: 'v' } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe('config.tags keys must be 1–128 characters (received 129).');
  });

  it('rejects a value longer than 256 characters', () => {
    const error = build({ tags: { k: 'v'.repeat(257) } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.tags["k"] must be at most 256 characters (received 257).',
    );
  });

  it('rejects a non-string value', () => {
    const error = build({ tags: { k: 7 } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    // The key is named, so a caller with fifty tags knows which one.
    expect(messageOf(error)).toBe('config.tags["k"] must be a string (received a number).');
  });
});

describe('encryptionConfiguration', () => {
  it.each(['AES256', 'aws:kms'])('accepts the documented sseType %s', (sseType) => {
    expect(build({ encryptionConfiguration: { sseType } })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects any other sseType', () => {
    const error = build({ encryptionConfiguration: { sseType: 'aws:kms:v2' } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.encryptionConfiguration.sseType must be one of "AES256", "aws:kms" ' +
        '(received "aws:kms:v2").',
    );
  });

  it('rejects a non-object encryptionConfiguration', () => {
    const error = build({ encryptionConfiguration: 'AES256' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.encryptionConfiguration must be an object (received a string).',
    );
  });
});

describe('client together with the options it would silently override', () => {
  it.each(['region', 'endpoint', 'maxAttempts', 'retryMode'])(
    'rejects client alongside %s rather than ignoring it',
    (option) => {
      const values: Record<string, unknown> = {
        region: 'us-west-2',
        endpoint: 'https://example.test',
        maxAttempts: 5,
        retryMode: 'adaptive',
      };
      const error = build({ [option]: values[option] });
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect((error as Error).message).toContain(option);
    },
  );

  it('rejects client alongside credentials', () => {
    const error = build({ credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.client was supplied together with config.credentials, which configure the ' +
        'client this store would otherwise build. A supplied client carries its own, so those ' +
        'settings would be silently ignored. Pass one or the other.',
    );
  });

  it('never names the credential material it rejects', () => {
    const error = build({ credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'sh' } });
    expect((error as Error).message).not.toContain('AKIAEXAMPLE');
  });

  it('accepts those options when no client is supplied', () => {
    expect(
      buildWithoutClient({
        region: 'us-east-1',
        endpoint: 'https://example.test',
        maxAttempts: 5,
        retryMode: 'adaptive',
      }),
    ).toBeInstanceOf(AmazonS3Vectors);
  });

  it('accepts a client on its own', () => {
    expect(build({})).toBeInstanceOf(AmazonS3Vectors);
  });
});

describe('bucket and index names', () => {
  it('rejects a non-string bucket name instead of reading .length off it', () => {
    const error = build({ vectorBucketName: 42 });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe('vectorBucketName must be a string (received a number).');
  });

  it('rejects a non-string index name', () => {
    const error = build({ indexName: null });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe('indexName must be a string (received null).');
  });

  it.each([
    [null, 'null'],
    [42, 'a number'],
    [['b'], 'an array'],
    [{}, 'an object'],
  ])('says what it got instead of a name, without printing it: %p', (value, described) => {
    const error = build({ vectorBucketName: value });
    expect((error as Error).message).toBe(
      `vectorBucketName must be a string (received ${described}).`,
    );
  });
});

describe('what construction does not do', () => {
  it('issues no AWS request', () => {
    const { client, mock } = createMockClient();
    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('configuration strings sent to AWS must be well-formed UTF-16 (T3-15)', () => {
  const LONE = 'k\ud800';

  it.each([
    [
      'pageContentMetadataKey',
      { pageContentMetadataKey: LONE },
      'config.pageContentMetadataKey contains an unpaired UTF-16 surrogate at position 1.',
    ],
    [
      'a nonFilterableMetadataKeys entry',
      { nonFilterableMetadataKeys: ['ok', LONE] },
      'config.nonFilterableMetadataKeys[1] contains an unpaired UTF-16 surrogate at position 1.',
    ],
    [
      'a tag key',
      { tags: { [LONE]: 'v' } },
      'config.tags has a key that contains an unpaired UTF-16 surrogate at position 1.',
    ],
    [
      'a tag value',
      { tags: { team: LONE } },
      'config.tags["team"] contains an unpaired UTF-16 surrogate at position 1.',
    ],
    [
      'encryptionConfiguration.kmsKeyArn',
      { encryptionConfiguration: { sseType: 'aws:kms', kmsKeyArn: LONE } },
      'config.encryptionConfiguration.kmsKeyArn contains an unpaired UTF-16 surrogate at position 1.',
    ],
  ])('refuses one in %s at construction', (_label, overrides, message) => {
    const error = build(overrides);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toContain(message);
  });

  it('refuses a kmsKeyArn that is not a string', () => {
    const error = build({ encryptionConfiguration: { sseType: 'aws:kms', kmsKeyArn: 42 } });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect(messageOf(error)).toBe(
      'config.encryptionConfiguration.kmsKeyArn must be a string (received a number).',
    );
  });

  it('accepts a surrogate pair in every one of them', () => {
    const pair = 'k😀';
    expect(
      build({
        pageContentMetadataKey: pair,
        nonFilterableMetadataKeys: [pair],
        tags: { [pair]: pair },
        encryptionConfiguration: {
          sseType: 'aws:kms',
          kmsKeyArn: `arn:aws:kms:us-east-1:1:key/${pair}`,
        },
      }),
    ).toBeInstanceOf(AmazonS3Vectors);
  });
});
