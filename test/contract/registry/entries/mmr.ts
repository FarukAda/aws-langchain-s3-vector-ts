import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import {
  DEFAULT_MAX_CONCURRENT,
  isAbortSignalLike,
  isAbsent,
  isOptionalIntegerUpTo,
  isOptionalSignal,
  isRecord,
  isValidFilter,
  MAX_TOP_K,
} from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** `maxMarginalRelevanceSearch(query, options, callbacks?, signal?)` as one value the corpus can vary. */
type MmrInput = readonly [query: unknown, options: unknown, callbacks: unknown, signal: unknown];

/**
 * What `maxMarginalRelevanceSearch` accepts, stated from the contract.
 *
 * The query is text for the embeddings model, so any string will do, an
 * unpaired surrogate included: it is never sent to AWS. The options bag is
 * required. `k` and `fetchK` are integers up to the `topK` ceiling, `lambda`
 * lies in [0, 1], and each may be absent. The callbacks slot takes anything but a
 * signal, and the signal slot takes nothing but one.
 */
function accepts([query, options, callbacks, signal]: MmrInput): boolean {
  if (typeof query !== 'string' || !isRecord(options)) return false;
  if (!isOptionalIntegerUpTo(options['k'], MAX_TOP_K)) return false;
  if (!isOptionalIntegerUpTo(options['fetchK'], MAX_TOP_K)) return false;
  const lambda: unknown = options['lambda'];
  if (!isAbsent(lambda) && !(typeof lambda === 'number' && lambda >= 0 && lambda <= 1)) {
    return false;
  }
  return (
    isValidFilter(options['filter']) && !isAbortSignalLike(callbacks) && isOptionalSignal(signal)
  );
}

const OPTIONS = { k: 2, fetchK: 3 } as const;

/** Filters built to reach every operand rule and structural rule, by name. */
const FILTER_CASES: readonly (readonly [label: string, filter: () => unknown])[] = [
  ['$in holding null', () => ({ g: { $in: [null] } })],
  ['$exists holding a string', () => ({ g: { $exists: 'yes' } })],
  ['$eq holding an array', () => ({ g: { $eq: ['a'] } })],
  ['$gt holding a string', () => ({ n: { $gt: '1' } })],
  ['$gt holding NaN', () => ({ n: { $gt: Number.NaN } })],
  ['$eq holding NaN', () => ({ n: { $eq: Number.NaN } })],
  ['a Date as the value', () => ({ at: new Date(0) })],
  ['two fields in one object', () => ({ g: 'a', h: 'b' })],
  ['two fields inside an $and element', () => ({ $and: [{ g: 'a', h: 'b' }] })],
  ['an empty operator object', () => ({ g: {} })],
  ['a non-operator key in an operator object', () => ({ g: { x: 1 } })],
  ['$and inside a field', () => ({ g: { $and: [{ g: 'a' }] } })],
  ['a string with an unpaired surrogate', () => ({ g: 'x\ud800' })],
  ['mixed types in $in are accepted', () => ({ g: { $in: ['a', 1, true] } })],
  ['two operators on one field are accepted', () => ({ n: { $gte: 0, $lte: 5 } })],
];

function cases(): readonly ContractCase<MmrInput>[] {
  const built: ContractCase<MmrInput>[] = [];
  const search = (options: unknown, callbacks?: unknown, signal?: unknown): MmrInput => [
    'query',
    options,
    callbacks,
    signal,
  ];

  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `query = ${value.label}`,
      input: [value.make(), { ...OPTIONS }, undefined, undefined],
      ambient: BENIGN,
    });
    built.push({ label: `options = ${value.label}`, input: search(value.make()), ambient: BENIGN });
    built.push({
      label: `options.k = ${value.label}`,
      input: search({ k: value.make() }),
      ambient: BENIGN,
    });
    built.push({
      label: `options.fetchK = ${value.label}`,
      input: search({ fetchK: value.make() }),
      ambient: BENIGN,
    });
    built.push({
      label: `options.lambda = ${value.label}`,
      input: search({ lambda: value.make() }),
      ambient: BENIGN,
    });
    built.push({
      label: `options.filter = ${value.label}`,
      input: search({ ...OPTIONS, filter: value.make() }),
      ambient: BENIGN,
    });
    built.push({
      label: `callbacks = ${value.label}`,
      input: search({ ...OPTIONS }, value.make()),
      ambient: BENIGN,
    });
    built.push({
      label: `signal = ${value.label}`,
      input: search({ ...OPTIONS }, undefined, value.make()),
      ambient: BENIGN,
    });
  }

  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid search under "${ambient.label}"`,
      input: search({ ...OPTIONS }),
      ambient,
    });
  }

  for (const [label, filter] of FILTER_CASES) {
    built.push({
      label: `filter: ${label}`,
      input: search({ ...OPTIONS, filter: filter() }),
      ambient: BENIGN,
    });
  }

  built.push({
    label: 'an already-fired signal aborts',
    input: search({ ...OPTIONS }, undefined, AbortSignal.abort()),
    ambient: BENIGN,
  });
  built.push({
    label: 'a signal in the callbacks slot is refused',
    input: search({ ...OPTIONS }, AbortSignal.abort()),
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
/** A failed `QueryVectors` or `GetVectors` request also names the request. */
const REQUEST_FAILURE = [...SCOPE, 'awsCommand'];
/**
 * The codes only a failed AWS request can raise. `ABORTED` is not among them:
 * an already-fired signal raises it before any request.
 */
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

/** The executable contract for `AmazonS3Vectors.maxMarginalRelevanceSearch`. */
export const mmrContract: EntryPointContract<MmrInput> = {
  symbol: 'AmazonS3Vectors.maxMarginalRelevanceSearch',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.EMBEDDINGS_MISSING,
    S3VectorsErrorCode.UNEXPECTED_ERROR,
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    S3VectorsErrorCode.AWS_INVALID_RESPONSE,
    S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED,
    S3VectorsErrorCode.THROTTLED,
    S3VectorsErrorCode.ACCESS_DENIED,
    S3VectorsErrorCode.AWS_REJECTED,
    S3VectorsErrorCode.NOT_FOUND,
    S3VectorsErrorCode.SERVICE_UNAVAILABLE,
    S3VectorsErrorCode.KMS_ERROR,
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
  ]),
  requiredContext: Object.fromEntries(
    Object.values(S3VectorsErrorCode).map((code) => [
      code,
      REQUEST_FAILURE_CODES.has(code) ? REQUEST_FAILURE : SCOPE,
    ]),
  ),
  accepts,
  invoke: async (store: AmazonS3Vectors, [query, options, callbacks, signal]: MmrInput) =>
    await store.maxMarginalRelevanceSearch(
      query as string,
      options as Parameters<AmazonS3Vectors['maxMarginalRelevanceSearch']>[1],
      callbacks as Parameters<AmazonS3Vectors['maxMarginalRelevanceSearch']>[2],
      signal as AbortSignal | undefined,
    ),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs'],
};
