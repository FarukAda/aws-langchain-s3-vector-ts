import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from './helpers.js';

/**
 * One test per domain cell of the constructor's configuration validation
 * (docs/CONTRACTS-DRAFT.md, "Store shell"; DESIGN.md D-33 and D-34).
 *
 * Every option here is reachable from an untyped JavaScript caller, from a
 * cast, and from a config assembled at runtime out of environment variables —
 * which is how most of them are actually built. Left unchecked each costs a
 * round trip, or surfaces as an uncoded `TypeError` from inside a later search.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

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
    // (`@aws-sdk/client-s3vectors@3.1118.0` `dist-types/models/enums.d.ts`).
    // Unchecked, this reaches CreateIndex — and assertMetricMatches then
    // compares an existing index against it and mismatches forever.
    const error = build({ distanceMetric: 'manhattan' });
    expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
    expect((error as Error).message).toContain('distanceMetric');
  });
});

describe('dataType', () => {
  it('rejects a non-string, which an untyped caller can still supply', () => {
    expect(codeOf(build({ dataType: 42 }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('accepts float32, the only member the service defines', () => {
    expect(build({ dataType: 'float32' })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects anything else', () => {
    expect(codeOf(build({ dataType: 'float64' }))).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('pageContentMetadataKey', () => {
  it('accepts null, which disables the page-content round-trip', () => {
    expect(build({ pageContentMetadataKey: null })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects the empty string rather than creating a zero-length metadata key', () => {
    // Only `undefined` triggers the default, so `''` survives into CreateIndex.
    expect(codeOf(build({ pageContentMetadataKey: '' }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a key longer than the documented 63 characters', () => {
    expect(codeOf(build({ pageContentMetadataKey: 'k'.repeat(64) }))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it('rejects a non-string, non-null value', () => {
    expect(codeOf(build({ pageContentMetadataKey: 42 }))).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('nonFilterableMetadataKeys', () => {
  it('accepts an array of strings', () => {
    expect(build({ nonFilterableMetadataKeys: ['blob'] })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-array instead of throwing a raw TypeError from the spread', () => {
    expect(codeOf(build({ nonFilterableMetadataKeys: 'blob' }))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it('rejects an entry that is not a string', () => {
    expect(codeOf(build({ nonFilterableMetadataKeys: ['ok', 7] }))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });
});

describe('relevanceScoreFn', () => {
  it('accepts a function', () => {
    expect(build({ relevanceScoreFn: (d: number) => 1 - d })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-function, which would otherwise fail inside a search', () => {
    expect(codeOf(build({ relevanceScoreFn: 'nope' }))).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('tags', () => {
  it('accepts string keys and values within the documented bounds', () => {
    expect(build({ tags: { env: 'prod', empty: '' } })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects a non-object', () => {
    expect(codeOf(build({ tags: ['env', 'prod'] }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a key longer than 128 characters', () => {
    expect(codeOf(build({ tags: { ['k'.repeat(129)]: 'v' } }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a value longer than 256 characters', () => {
    expect(codeOf(build({ tags: { k: 'v'.repeat(257) } }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a non-string value', () => {
    expect(codeOf(build({ tags: { k: 7 } }))).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('encryptionConfiguration', () => {
  it.each(['AES256', 'aws:kms'])('accepts the documented sseType %s', (sseType) => {
    expect(build({ encryptionConfiguration: { sseType } })).toBeInstanceOf(AmazonS3Vectors);
  });

  it('rejects any other sseType', () => {
    expect(codeOf(build({ encryptionConfiguration: { sseType: 'aws:kms:v2' } }))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
  });

  it('rejects a non-object encryptionConfiguration', () => {
    expect(codeOf(build({ encryptionConfiguration: 'AES256' }))).toBe(
      S3VectorsErrorCode.VALIDATION,
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
    expect(codeOf(build({ credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' } }))).toBe(
      S3VectorsErrorCode.VALIDATION,
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
    expect(codeOf(build({ vectorBucketName: 42 }))).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('rejects a non-string index name', () => {
    expect(codeOf(build({ indexName: null }))).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('what construction does not do', () => {
  it('issues no AWS request', () => {
    const { client, mock } = createMockClient();
    new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    expect(mock.calls()).toHaveLength(0);
  });
});
