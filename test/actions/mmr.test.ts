import { GetVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { mmrSearch, resolveMmrParameters } from '../../src/actions/mmr.js';
import { parseFilter } from '../../src/internal/filter.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { createMockClient } from '../helpers.js';

/**
 * One test per domain cell of `mmrSearch`. The selection itself is core's
 * `maximalMarginalRelevance` (`@langchain/core@1.2.11`
 * `dist/utils/math.d.ts:40`) — this package fetches the candidates and their
 * vectors and maps the result.
 */
const codeOf = (e: unknown): string | undefined => (e as { code?: string }).code;

const VECTORS: Record<string, number[]> = {
  same: [1, 0, 0],
  near: [0.9, 0.1, 0],
  orth: [0, 1, 0],
};

function setup(present: string[] = Object.keys(VECTORS)) {
  const { client, mock } = createMockClient();
  mock.on(QueryVectorsCommand).resolves({
    distanceMetric: 'cosine',
    vectors: Object.keys(VECTORS).map((key) => ({ key, metadata: { name: key } })),
  });
  mock.on(GetVectorsCommand).callsFake((input: { keys: string[] }) => ({
    vectors: input.keys
      .filter((k) => present.includes(k))
      .map((k) => ({ key: k, data: { float32: VECTORS[k] }, metadata: { name: k } })),
  }));
  // `k`, `fetchK` and `lambda` go through `resolveMmrParameters`, as the store
  // sends them: it is the only thing that can produce the checked values
  // `mmrSearch` asks for, so it is where a bad one is refused. `async`, so that
  // refusal is a rejection here as it is from the store.
  const run = async ({
    k = 2,
    fetchK = 3,
    lambda = 0.5,
    ...overrides
  }: Record<string, unknown> = {}) =>
    await mmrSearch({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: 'cosine',
      queryVector: [1, 0, 0],
      ...resolveMmrParameters(
        { k, fetchK, lambda } as { k: number; fetchK: number; lambda: number },
        'maxMarginalRelevanceSearch',
        { vectorBucketName: 'b', indexName: 'i' },
      ),
      pageContentMetadataKey: null,
      maxConcurrent: 10,
      ...overrides,
    });
  return { mock, run };
}

describe('mmrSearch', () => {
  it('fetches candidates as keys only, then their vectors and metadata', async () => {
    const { mock, run } = setup();
    await run();
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({
      topK: 3,
      returnDistance: false,
      returnMetadata: false,
    });
    expect(mock.commandCalls(GetVectorsCommand)[0]!.args[0].input).toMatchObject({
      returnData: true,
      returnMetadata: true,
    });
  });

  it('prefers a diverse result over a near-duplicate of the best match', async () => {
    const { run } = setup();
    // lambda 0.2 leans toward diversity. At 0.5 this fixture is a genuine tie:
    // the best match is identical to the query, so sim(d, selected) equals
    // sim(d, query) for every candidate and every score collapses to
    // (2·lambda - 1)·s, which is zero — leaving index order to decide.
    const docs = await run({ lambda: 0.2 });
    const names = docs.map((d) => d.metadata['name']);
    expect(names[0]).toBe('same');
    expect(names[1]).toBe('orth');
  });

  it('leans toward relevance at a high lambda, taking the near-duplicate', async () => {
    const { run } = setup();
    const docs = await run({ lambda: 0.9 });
    expect(docs.map((d) => d.metadata['name'])[1]).toBe('near');
  });

  it('returns at most k documents', async () => {
    const { run } = setup();
    expect(await run({ k: 1 })).toHaveLength(1);
  });

  it('returns at most fetchK when fetchK is below k, without erroring', async () => {
    const { run } = setup();
    const docs = await run({ k: 10, fetchK: 2 });
    expect(docs.length).toBeLessThanOrEqual(2);
  });

  it('skips a candidate deleted between the two calls rather than failing', async () => {
    // `near` vanishes after QueryVectors listed it.
    const { run } = setup(['same', 'orth']);
    const docs = await run();
    expect(docs.map((d) => d.metadata['name'])).not.toContain('near');
    expect(docs.length).toBeGreaterThan(0);
  });

  it('returns nothing when every candidate has vanished', async () => {
    const { run } = setup([]);
    expect(await run()).toEqual([]);
  });

  it('returns nothing, and fetches nothing, when the search finds no candidates', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({ distanceMetric: 'cosine', vectors: [] });
    const docs = await mmrSearch({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: 'cosine',
      queryVector: [1, 0, 0],
      ...resolveMmrParameters({ k: 2, fetchK: 3, lambda: 0.5 }, 'maxMarginalRelevanceSearch', {
        vectorBucketName: 'b',
        indexName: 'i',
      }),
      pageContentMetadataKey: null,
      maxConcurrent: 10,
    });
    expect(docs).toEqual([]);
    expect(mock.commandCalls(GetVectorsCommand)).toHaveLength(0);
  });

  it('forwards the filter it was given to the candidate query', async () => {
    // A filter reaching here has been parsed at the boundary the call came
    // through — `ParsedFilter` is not constructible anywhere else — so this
    // action sends it rather than checking it again. The refusal of a
    // malformed filter is a boundary guarantee and is tested there, against
    // the store, where "before the billable embed" can also be asserted.
    const { mock, run } = setup();
    const filter = parseFilter({ genre: { $eq: 'scifi' } }, 'maxMarginalRelevanceSearch', {
      vectorBucketName: 'b',
      indexName: 'i',
    });
    await run({ filter });
    expect(mock.commandCalls(QueryVectorsCommand)[0]!.args[0].input).toMatchObject({
      filter: { genre: { $eq: 'scifi' } },
    });
  });

  it('names the parameter, the range and what it got', async () => {
    const { mock, run } = setup();
    const error = await run({ k: 0 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe('k must be an integer between 1 and 10000 (received 0).');
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it('says why a lambda outside the range is refused rather than clamped', async () => {
    const { run } = setup();
    const error = await run({ lambda: 1.5 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'lambda must be between 0 and 1 (received 1.5). Outside that range the selection is ' +
        'not a trade-off between relevance and diversity.',
    );
  });

  it.each([0, -1, 10_001, 1.5])('rejects k of %p before any request', async (k) => {
    const { mock, run } = setup();
    expect(codeOf(await run({ k }).catch((e: unknown) => e))).toBe(S3VectorsErrorCode.VALIDATION);
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it.each([0, 10_001])('rejects fetchK of %p before any request', async (fetchK) => {
    const { mock, run } = setup();
    expect(codeOf(await run({ fetchK }).catch((e: unknown) => e))).toBe(
      S3VectorsErrorCode.VALIDATION,
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it.each([-0.1, 1.1])(
    'rejects lambda of %p, outside which the selection is arbitrary',
    async (lambda) => {
      const { run } = setup();
      expect(codeOf(await run({ lambda }).catch((e: unknown) => e))).toBe(
        S3VectorsErrorCode.VALIDATION,
      );
    },
  );

  it.each([0, 0.5, 1])('accepts lambda of %p', async (lambda) => {
    const { run } = setup();
    await expect(run({ lambda })).resolves.toBeDefined();
  });

  it('rejects a candidate vector returned without data despite returnData', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      vectors: [{ key: 'same', metadata: {} }],
    });
    mock.on(GetVectorsCommand).resolves({ vectors: [{ key: 'same', metadata: {} }] });
    const error = await mmrSearch({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: 'cosine',
      queryVector: [1, 0, 0],
      ...resolveMmrParameters({ k: 1, fetchK: 1, lambda: 0.5 }, 'maxMarginalRelevanceSearch', {
        vectorBucketName: 'b',
        indexName: 'i',
      }),
      pageContentMetadataKey: null,
      maxConcurrent: 10,
    }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    // Names the command and the key, so a caller can tell which of the two
    // requests MMR makes came back wrong, and for which candidate.
    expect((error as Error).message).toContain(
      "GetVectors returned vector 'same' without data, even though this call requested",
    );
    expect((error as Error).message).toContain(
      'incompatible SDK version or a mocked/stubbed client',
    );
  });

  it('rejects a candidate that came back with an empty embedding, as a listing does', async () => {
    // `[]` satisfies a check for `undefined`, so a candidate with no embedding
    // at all went into the selection as though it had one, and came back out
    // ranked — the same value `listVectors` has always refused.
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      distanceMetric: 'cosine',
      vectors: [{ key: 'same' }, { key: 'hollow' }],
    });
    mock.on(GetVectorsCommand).resolves({
      vectors: [
        { key: 'same', data: { float32: [1, 0, 0] }, metadata: {} },
        { key: 'hollow', data: { float32: [] }, metadata: {} },
      ],
    });
    const error = await mmrSearch({
      client,
      vectorBucketName: 'b',
      indexName: 'i',
      operation: 'maxMarginalRelevanceSearch',
      distanceMetric: 'cosine',
      queryVector: [1, 0, 0],
      ...resolveMmrParameters({ k: 2, fetchK: 2, lambda: 0.5 }, 'maxMarginalRelevanceSearch', {
        vectorBucketName: 'b',
        indexName: 'i',
      }),
      pageContentMetadataKey: null,
      maxConcurrent: 10,
    }).catch((e: unknown) => e);
    expect(codeOf(error)).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect((error as Error).message).toContain("vector 'hollow' with an empty embedding");
  });

  it('rejects ABORTED without issuing a request when the signal has already fired', async () => {
    const { mock, run } = setup();
    const ac = new AbortController();
    ac.abort();
    expect(codeOf(await run({ signal: ac.signal }).catch((e: unknown) => e))).toBe(
      S3VectorsErrorCode.ABORTED,
    );
    expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
  });

  it.each([
    ['a zero vector', [0, 0, 0], 'Query vector has zero norm'],
    [
      'a NaN component',
      [1, Number.NaN, 0],
      'Query vector has a component at position 1 that is not a finite number',
    ],
    ['an empty vector', [], 'Query vector has dimension 0'],
    ['a non-array', null, 'Query vector is not an array'],
  ])(
    'refuses %s before any request, as similarity search does (R4)',
    async (_label, queryVector, message) => {
      const { mock, run } = setup();
      const error = await run({ queryVector }).catch((e: unknown) => e);
      expect(codeOf(error)).toBe(S3VectorsErrorCode.VALIDATION);
      expect((error as Error).message).toContain(message);
      expect(mock.commandCalls(QueryVectorsCommand)).toHaveLength(0);
    },
  );
});
