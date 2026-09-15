import type { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { assertValidConfig, resolveClient } from '../src/shared/validation.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';
import { BASE_CONFIG, createMockClient } from './helpers.js';

/**
 * A store-built client can be waited on forever (F-03), and the options that
 * build it were never checked (F-07).
 *
 * The SDK applies no timeout of any kind by default, so an endpoint that
 * accepts a connection and never answers blocks `getByIds`, `addDocuments` and
 * every search indefinitely unless the caller passes an `AbortSignal`. The
 * README never said so.
 *
 * The audit's proposed fix does not work, which is why this pins the resolved
 * handler configuration rather than the option names. Measured against a local
 * server that accepts and never replies:
 *
 *     no timeouts                              STILL PENDING after 2511ms
 *     requestTimeout + connectionTimeout       STILL PENDING after 2509ms  [WARN]
 *     requestTimeout + throwOnRequestTimeout   REJECTED TimeoutError 804ms
 *     socketTimeout + connectionTimeout        REJECTED TimeoutError 810ms
 *
 * `requestTimeout` only *warns* unless `throwOnRequestTimeout` is set as well —
 * the SDK's own option documentation says so. And it is a total deadline, so
 * defaulting it would abort a legitimately slow 500-vector upload. `socketTimeout`
 * is idle-based: it ends a black-holed request without touching a transfer that
 * is still making progress. That is what gets the default.
 */

/** The options the SDK resolved for the handler it built. */
async function handlerConfig(client: S3VectorsClient): Promise<Record<string, unknown>> {
  const handler = client.config.requestHandler as unknown as {
    configProvider?: Promise<Record<string, unknown>>;
    config?: Record<string, unknown>;
  };
  return (await handler.configProvider) ?? handler.config ?? {};
}

const SCOPE = { vectorBucketName: 'test-bucket', indexName: 'test-index' };

function build(config: Partial<AmazonS3VectorsConfig>): S3VectorsClient {
  return resolveClient({ ...BASE_CONFIG, ...config }, SCOPE);
}

/** Validate a config and return the coded error it raised. */
function rejectionFor(config: Partial<AmazonS3VectorsConfig>): { code: string; message: string } {
  try {
    assertValidConfig({ ...BASE_CONFIG, ...config });
  } catch (error: unknown) {
    if (!isS3VectorsError(error)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error('expected the config to be rejected, but it was accepted');
}

describe('a store-built client cannot be waited on forever', () => {
  it('applies a connection timeout and an idle socket timeout by default', async () => {
    const config = await handlerConfig(build({}));

    expect(config['connectionTimeout']).toBeGreaterThan(0);
    expect(config['socketTimeout']).toBeGreaterThan(0);
  });

  it('does not default requestTimeout, which is a total deadline', async () => {
    // A 500-vector batch at 4096 dimensions is a large upload. An idle timeout
    // never fires while it is progressing; a total deadline would end it.
    const config = await handlerConfig(build({}));

    expect(config['requestTimeout']).toBeUndefined();
  });

  it('honours caller-supplied timeouts', async () => {
    const config = await handlerConfig(build({ connectionTimeout: 1234, socketTimeout: 5678 }));

    expect(config['connectionTimeout']).toBe(1234);
    expect(config['socketTimeout']).toBe(5678);
  });

  it('lets 0 disable a timeout, which is the SDK’s own meaning for it', async () => {
    const config = await handlerConfig(build({ connectionTimeout: 0, socketTimeout: 0 }));

    expect(config['connectionTimeout']).toBe(0);
    expect(config['socketTimeout']).toBe(0);
  });

  it('pairs requestTimeout with throwOnRequestTimeout, so it means what it says', async () => {
    // Without the flag the SDK logs "a request has exceeded the configured
    // requestTimeout" and keeps waiting — a caller who set it would believe
    // they were protected and would not be.
    const config = await handlerConfig(build({ requestTimeout: 9000 }));

    expect(config['requestTimeout']).toBe(9000);
    expect(config['throwOnRequestTimeout']).toBe(true);
  });

  it('leaves a caller-supplied client exactly as it was built', async () => {
    const { client } = createMockClient();
    const resolved = resolveClient({ ...BASE_CONFIG, client }, SCOPE);

    expect(resolved).toBe(client);
    const config = await handlerConfig(resolved);
    expect(config['socketTimeout']).toBeUndefined();
  });
});

describe('the options that build the client are validated', () => {
  it.each([
    ['retryMode', 'bogus'],
    ['retryMode', 42],
    ['maxAttempts', 0],
    ['maxAttempts', -1],
    ['maxAttempts', 1.5],
    ['maxAttempts', 'three'],
    ['region', 123],
    ['region', ''],
    ['endpoint', 'not a url'],
    ['endpoint', 42],
    ['credentials', 'a string'],
    ['createIndexIfNotExist', 'false'],
    ['createIndexIfNotExist', 1],
    ['connectionTimeout', -1],
    ['socketTimeout', 'soon'],
    ['requestTimeout', Number.NaN],
  ])('rejects %s = %p', (option, value) => {
    const { code, message } = rejectionFor({ [option]: value });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(message).toContain(option);
  });

  it('never echoes credential material in the message', () => {
    const { message } = rejectionFor({
      credentials: 'AKIAIOSFODNN7EXAMPLE' as unknown as AmazonS3VectorsConfig['credentials'],
    });
    expect(message).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('accepts the values that are actually valid', () => {
    expect(() =>
      assertValidConfig({
        ...BASE_CONFIG,
        region: 'us-east-1',
        endpoint: 'https://example.invalid',
        maxAttempts: 5,
        retryMode: 'adaptive',
        createIndexIfNotExist: false,
        connectionTimeout: 0,
        socketTimeout: 30_000,
        requestTimeout: 120_000,
        credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      }),
    ).not.toThrow();
  });

  it('accepts a credentials provider function', () => {
    expect(() =>
      assertValidConfig({
        ...BASE_CONFIG,
        credentials: async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
      }),
    ).not.toThrow();
  });

  it('rejects a timeout option supplied alongside a client', () => {
    const { client } = createMockClient();
    const { code, message } = rejectionFor({ client, socketTimeout: 1000 });
    expect(code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(message).toContain('socketTimeout');
  });
});
