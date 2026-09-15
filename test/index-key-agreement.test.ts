import { CreateIndexCommand, GetIndexCommand, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import type { AmazonS3VectorsConfig } from '../src/types.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings, indexFixture } from './helpers.js';

/**
 * The store's non-filterable keys must be the index's (F-05).
 *
 * `nonFilterableMetadataKeys` is documented as "metadata keys that should not
 * be filterable in queries" — a statement about the index, not merely about one
 * this store happens to create. Two things read it, and only one of them was
 * ever checked against reality: `CreateIndex` uses it to configure a new index,
 * and the 2 KB filterable-metadata budget uses it to decide, locally, whether a
 * write can succeed.
 *
 * When the two disagree the budget is computed against the wrong set, and it
 * fails in both directions. Confirmed against the live service on an ephemeral
 * bucket: the identical 3,000-byte value was rejected on an index that did not
 * declare its key non-filterable —
 *
 *     ValidationException: Filterable metadata must have at most 2048 bytes
 *
 * — and accepted on one that did. So a store whose list is short of the index's
 * refuses writes AWS would take, and a store whose list is longer sends writes
 * AWS refuses, after the embedding has been paid for.
 *
 * The default configuration makes this easy to hit without noticing: the store
 * adds `pageContentMetadataKey` to its own non-filterable set, so pointing a
 * default store at an index created elsewhere — by the console, or by `aws
 * s3vectors create-index` — disagrees immediately, and page content silently
 * consumes the filterable budget.
 *
 * The index is therefore checked where this package already looks at it, the
 * same way `distanceMetric` is checked against every first query page.
 */

function storeFor(
  indexKeys: string[] | undefined,
  config: Partial<AmazonS3VectorsConfig> = {},
): AmazonS3Vectors {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).resolves({
    index: indexFixture(
      indexKeys === undefined
        ? // An index that names no non-filterable keys at all: AWS omits the
          // member entirely for one, which the fixture otherwise supplies.
          { metadataConfiguration: undefined }
        : { metadataConfiguration: { nonFilterableMetadataKeys: indexKeys } },
    ),
  });
  mock.on(CreateIndexCommand).resolves({});
  mock.on(PutVectorsCommand).resolves({});
  return new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, ...config, client });
}

async function writeWith(store: AmazonS3Vectors): Promise<S3VectorsError | undefined> {
  try {
    await store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'text' })]);
    return undefined;
  } catch (error: unknown) {
    if (isS3VectorsError(error)) return error;
    throw error;
  }
}

describe('a store writing to an index checks they agree on non-filterable keys', () => {
  it('accepts an index whose keys match the store', async () => {
    // The default store adds its page-content key to the set, so an index it
    // created itself carries exactly this.
    await expect(writeWith(storeFor(['_page_content']))).resolves.toBeUndefined();
  });

  it('refuses an index that declares none, where the store expects its page-content key', async () => {
    // The common case: an index created by the console or the CLI, used with a
    // default store. Page content would silently spend the 2 KB filterable
    // budget, and the store's local check would never say so.
    const error = await writeWith(storeFor(undefined));

    expect(error?.code).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(error?.message).toContain('_page_content');
  });

  it('refuses an index whose keys are a superset of the store’s', async () => {
    const error = await writeWith(storeFor(['_page_content', 'big_blob']));

    expect(error?.code).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(error?.message).toContain('big_blob');
  });

  it('refuses an index whose keys are a subset of the store’s', async () => {
    const error = await writeWith(
      storeFor(['_page_content'], { nonFilterableMetadataKeys: ['big_blob'] }),
    );

    expect(error?.code).toBe(S3VectorsErrorCode.INDEX_CONFIG_MISMATCH);
    expect(error?.message).toContain('big_blob');
  });

  it('ignores ordering, which carries no meaning', async () => {
    await expect(
      writeWith(storeFor(['b', '_page_content', 'a'], { nonFilterableMetadataKeys: ['a', 'b'] })),
    ).resolves.toBeUndefined();
  });

  it('says nothing when the store stores no page content and declares no keys', async () => {
    await expect(
      writeWith(storeFor(undefined, { pageContentMetadataKey: null })),
    ).resolves.toBeUndefined();
  });

  it('does not check an index it is creating, which it configures itself', async () => {
    const { client, mock } = createMockClient();
    const notFound = Object.assign(new Error('nope'), { name: 'NotFoundException' });
    mock.on(GetIndexCommand).rejects(notFound);
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    await expect(writeWith(store)).resolves.toBeUndefined();
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(1);
  });

  it('cannot be misled by a malformed response into thinking the index is absent', async () => {
    // `indexExists` proves existence from the 200, never from the body. A
    // response whose body says nothing must still count as existing — only the
    // key check is skipped, because there is nothing to check against.
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({});
    mock.on(CreateIndexCommand).resolves({});
    mock.on(PutVectorsCommand).resolves({});
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    await expect(writeWith(store)).resolves.toBeUndefined();
    expect(mock.commandCalls(CreateIndexCommand)).toHaveLength(0);
  });
});

/**
 * The local budget rejection has to be able to explain itself.
 *
 * A store whose non-filterable list falls short of the index's refuses writes
 * AWS would accept, and it refuses them in `buildPutMetadata` — which runs
 * before `ensureExists`, so the index is never consulted and the mismatch check
 * never fires. That ordering is deliberate and stays: a write that cannot
 * succeed should not first create an index or spend a round trip.
 *
 * The cost is that this one rejection cannot name the real cause, so it must
 * name what it measured instead, and say that the index's set is the one that
 * actually counts.
 */
describe('the filterable-budget rejection names what it budgeted against', () => {
  it('lists the keys the store treats as non-filterable, and says the index decides', async () => {
    const { client, mock } = createMockClient();
    mock.on(GetIndexCommand).resolves({ index: indexFixture() });
    mock.on(PutVectorsCommand).resolves({});
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    // Store and index agree here, so nothing below is about a mismatch.
    await expect(writeWith(store)).resolves.toBeUndefined();

    const oversized = await store
      .addVectors(
        [[0.1, 0.2, 0.3]],
        [new Document({ pageContent: 't', metadata: { big: 'x'.repeat(3000) } })],
      )
      .then(() => undefined)
      .catch((e: unknown) => (isS3VectorsError(e) ? e : undefined));

    expect(oversized?.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(oversized?.message).toContain('"_page_content"');
    expect(oversized?.message).toContain('nonFilterableMetadataKeys');
  });
});
