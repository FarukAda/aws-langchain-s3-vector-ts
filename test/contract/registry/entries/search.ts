import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import {
  DEFAULT_MAX_CONCURRENT,
  isAbortSignalLike,
  isAbsent,
  isOptionalIntegerUpTo,
  isOptionalSignal,
  isValidFilter,
  MAX_TOP_K,
} from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

/**
 * The read path, which is what a LangChain consumer actually reaches.
 *
 * `similaritySearch` is the method `@langchain/core`'s own `VectorStoreRetriever`
 * dispatches to, `similaritySearchVectorWithScore` is the one abstract member of
 * core's `VectorStore` this package implements, and `similaritySearchWithScore`
 * is the public scored entry point. All three were outside the conformance
 * registry — listed as pending — while the `describe` around it said the
 * registry "covers the public surface". So none of the six properties, and none
 * of the hostile corpus that found the `NaN` and sparse-array defects on the
 * write path, had ever swept a query.
 *
 * They share one domain: a query, a `k`, a filter, the `Callbacks` slot and a
 * signal, in that order — the difference between them is what they return, not
 * what they accept. One `accepts` and one case list therefore serve all three,
 * which is also what makes a divergence between them visible.
 */
const BENIGN = AMBIENTS[0] as Ambient;

/** `search(query, k?, filter?, callbacks?, signal?)` as one value the corpus can vary. */
type SearchInput = readonly [
  query: unknown,
  k: unknown,
  filter: unknown,
  callbacks: unknown,
  signal: unknown,
];

/**
 * What the text searches accept, stated from the contract rather than the code.
 *
 * The query is text for the embeddings model, so any string will do — an
 * unpaired surrogate included, since it is embedded and never sent to AWS. `k`
 * is an integer from 1 to the `topK` ceiling, or absent. The filter is the
 * documented grammar. The fourth slot is core's `Callbacks`, which takes
 * anything except a signal — a signal there was silently dropped through 0.x,
 * letting a search run uncancelled after a billable `embedQuery` — and the
 * fifth takes nothing but one.
 */
function accepts([query, k, filter, callbacks, signal]: SearchInput): boolean {
  if (typeof query !== 'string') return false;
  if (!isAbsent(k) && !isOptionalIntegerUpTo(k, MAX_TOP_K)) return false;
  if (k === 0) return false;
  return isValidFilter(filter) && !isAbortSignalLike(callbacks) && isOptionalSignal(signal);
}

/**
 * The same, for the vector-taking sibling: the first argument is an embedding.
 *
 * It takes **three** arguments — `(query, k, filter)` — because that is core's
 * abstract member's signature; there is no callbacks slot and no signal, so
 * neither is constrained here and neither is varied in its cases.
 */
function acceptsVector([vector, k, filter]: SearchInput): boolean {
  if (!Array.isArray(vector) || vector.length === 0 || vector.length > 4096) return false;
  if (!vector.every((component) => typeof component === 'number' && Number.isFinite(component))) {
    return false;
  }
  // A zero vector is refused on a cosine index, which is what the registry's
  // store is configured for (docs/evidence/zero-vector.md).
  if (vector.every((component) => component === 0)) return false;
  // `k` is required here — a positional argument, not an option.
  if (isAbsent(k) || !isOptionalIntegerUpTo(k, MAX_TOP_K) || k === 0) return false;
  return isValidFilter(filter);
}

/** Filters built to reach each structural rule by name, as the MMR entry does. */
const FILTER_CASES: readonly (readonly [label: string, filter: () => unknown])[] = [
  ['an empty object', () => ({})],
  ['two conditions in one object', () => ({ a: 1, b: 2 })],
  ['an operator where a field belongs', () => ({ $eq: 1 })],
  ['an unknown $-operator', () => ({ a: { $like: 'x' } })],
  ['$and holding an empty array', () => ({ $and: [] })],
  ['$or holding a non-condition', () => ({ $or: [1] })],
  ['$in holding an empty array', () => ({ a: { $in: [] } })],
  ['$gt holding a string', () => ({ a: { $gt: 'x' } })],
  ['a NaN operand', () => ({ a: { $eq: Number.NaN } })],
  ['a Date operand', () => ({ a: { $eq: new Date() } })],
  ['a field name with an unpaired surrogate', () => ({ ['k\ud800']: 'x' })],
  ['a valid nested filter', () => ({ $and: [{ a: { $gte: 1 } }, { b: { $in: ['x'] } }] })],
];

function casesFor(
  validFirstArgument: () => unknown,
  options: { readonly takesSignal: boolean },
): readonly ContractCase<SearchInput>[] {
  const built: ContractCase<SearchInput>[] = [];
  const arg = validFirstArgument;

  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `query = ${value.label}`,
      input: [value.make(), 2, undefined, undefined, undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `k = ${value.label}`,
      input: [arg(), value.make(), undefined, undefined, undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `filter = ${value.label}`,
      input: [arg(), 2, value.make(), undefined, undefined],
      ambient: BENIGN,
    });
    // Only where the method has those slots. `similaritySearchVectorWithScore`
    // takes three positional arguments, so varying a fourth or fifth would be
    // varying something the call never receives — a case that can only pass.
    if (options.takesSignal) {
      built.push({
        label: `signal = ${value.label}`,
        input: [arg(), 2, undefined, undefined, value.make()],
        ambient: BENIGN,
      });
    }
  }

  for (const [label, filter] of FILTER_CASES) {
    built.push({
      label: `filter is ${label}`,
      input: [arg(), 2, filter(), undefined, undefined],
      ambient: BENIGN,
    });
  }

  // A valid call under every ambient condition — this is what makes the
  // declared error codes reachable at all.
  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid search under "${ambient.label}"`,
      input: [arg(), 2, undefined, undefined, undefined],
      ambient,
    });
  }

  built.push({
    label: 'k at the topK ceiling',
    input: [arg(), MAX_TOP_K, undefined, undefined, undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'k one past the topK ceiling',
    input: [arg(), MAX_TOP_K + 1, undefined, undefined, undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'k = 0',
    input: [arg(), 0, undefined, undefined, undefined],
    ambient: BENIGN,
  });
  if (options.takesSignal) {
    built.push({
      label: 'an already-fired signal aborts',
      input: [arg(), 2, undefined, undefined, AbortSignal.abort()],
      ambient: BENIGN,
    });
    built.push({
      label: 'a signal in the callbacks slot is refused, not dropped',
      input: [arg(), 2, undefined, AbortSignal.abort(), undefined],
      ambient: BENIGN,
    });
  }
  built.push({
    label: 'null filter searches unfiltered',
    input: [arg(), 2, null, undefined, undefined],
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
const REQUEST_FAILURE = [...SCOPE, 'awsCommand'];

const REQUEST_FAILURE_CODES: ReadonlySet<S3VectorsErrorCode> = new Set([
  S3VectorsErrorCode.THROTTLED,
  S3VectorsErrorCode.ACCESS_DENIED,
  S3VectorsErrorCode.AWS_REJECTED,
  S3VectorsErrorCode.NOT_FOUND,
  S3VectorsErrorCode.SERVICE_UNAVAILABLE,
  S3VectorsErrorCode.QUOTA_EXCEEDED,
  S3VectorsErrorCode.CONFLICT,
  S3VectorsErrorCode.KMS_ERROR,
  S3VectorsErrorCode.AWS_REQUEST_FAILED,
]);

/** Every code a read may escape with. A read never writes, so no write code is here. */
const SEARCH_CODES = new Set([
  S3VectorsErrorCode.VALIDATION,
  S3VectorsErrorCode.ABORTED,
  S3VectorsErrorCode.EMBEDDINGS_MISSING,
  S3VectorsErrorCode.EMBEDDINGS_FAILED,
  S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
  S3VectorsErrorCode.AWS_INVALID_RESPONSE,
  S3VectorsErrorCode.PAGE_LIMIT_EXCEEDED,
  S3VectorsErrorCode.THROTTLED,
  S3VectorsErrorCode.ACCESS_DENIED,
  S3VectorsErrorCode.AWS_REJECTED,
  S3VectorsErrorCode.NOT_FOUND,
  S3VectorsErrorCode.SERVICE_UNAVAILABLE,
  S3VectorsErrorCode.KMS_ERROR,
  S3VectorsErrorCode.AWS_REQUEST_FAILED,
]);

const REQUIRED_CONTEXT = Object.fromEntries(
  Object.values(S3VectorsErrorCode).map((code) => [
    code,
    REQUEST_FAILURE_CODES.has(code) ? REQUEST_FAILURE : SCOPE,
  ]),
);

const VALID_QUERY = (): string => 'a query';
const VALID_VECTOR = (): number[] => [0.1, 0.2, 0.3];

/** The executable contract for `AmazonS3Vectors.similaritySearch`. */
export const similaritySearchContract: EntryPointContract<SearchInput> = {
  symbol: 'AmazonS3Vectors.similaritySearch',
  mayThrow: SEARCH_CODES,
  requiredContext: REQUIRED_CONTEXT,
  accepts,
  invoke: async (store: AmazonS3Vectors, [query, k, filter, callbacks, signal]: SearchInput) =>
    await store.similaritySearch(
      query as string,
      k as number | undefined,
      filter as Parameters<AmazonS3Vectors['similaritySearch']>[2],
      callbacks as Parameters<AmazonS3Vectors['similaritySearch']>[3],
      signal as AbortSignal | undefined,
    ),
  cases: () => casesFor(VALID_QUERY, { takesSignal: true }),
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
};

/** The executable contract for `AmazonS3Vectors.similaritySearchWithScore`. */
export const similaritySearchWithScoreContract: EntryPointContract<SearchInput> = {
  ...similaritySearchContract,
  symbol: 'AmazonS3Vectors.similaritySearchWithScore',
  invoke: async (store: AmazonS3Vectors, [query, k, filter, callbacks, signal]: SearchInput) =>
    await store.similaritySearchWithScore(
      query as string,
      k as number | undefined,
      filter as Parameters<AmazonS3Vectors['similaritySearchWithScore']>[2],
      callbacks as Parameters<AmazonS3Vectors['similaritySearchWithScore']>[3],
      signal as AbortSignal | undefined,
    ),
};

/**
 * The executable contract for `AmazonS3Vectors.similaritySearchVectorWithScore`.
 *
 * The one *abstract* member of core's `VectorStore` among these, and the only
 * one that takes an embedding rather than text — so it needs no model, and
 * `EMBEDDINGS_MISSING` is not among its codes.
 */
export const similaritySearchVectorContract: EntryPointContract<SearchInput> = {
  symbol: 'AmazonS3Vectors.similaritySearchVectorWithScore',
  // Three codes its siblings declare are unreachable here, and saying so is
  // the point of declaring a closed set at all: it takes an embedding, so it
  // needs no model and cannot raise EMBEDDINGS_MISSING; it has no signal
  // parameter — core's abstract member has three positional arguments — so it
  // cannot raise ABORTED; and with no model to call, nothing can reach
  // EMBEDDINGS_FAILED either. The conformance run rejected the wider set.
  mayThrow: new Set(
    [...SEARCH_CODES].filter(
      (code) =>
        code !== S3VectorsErrorCode.EMBEDDINGS_MISSING &&
        code !== S3VectorsErrorCode.ABORTED &&
        code !== S3VectorsErrorCode.EMBEDDINGS_FAILED,
    ),
  ),
  requiredContext: REQUIRED_CONTEXT,
  accepts: acceptsVector,
  invoke: async (store: AmazonS3Vectors, [vector, k, filter]: SearchInput) =>
    await store.similaritySearchVectorWithScore(
      vector as number[],
      k as number,
      filter as Parameters<AmazonS3Vectors['similaritySearchVectorWithScore']>[2],
    ),
  cases: () => casesFor(VALID_VECTOR, { takesSignal: false }),
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
};
