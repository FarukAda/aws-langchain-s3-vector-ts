import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import {
  DEFAULT_MAX_CONCURRENT,
  isAbsent,
  isKeyList,
  isOptionalIntegerUpTo,
  isOptionalSignal,
  isRecord,
  MAX_GET_BATCH_SIZE,
} from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** `getByIds(ids, options?)` as one value the corpus can vary. */
type GetByIdsInput = readonly [ids: unknown, options: unknown];

/**
 * What `getByIds` accepts, stated from the contract rather than from the code.
 *
 * A key is held to `GetVectors`' own bounds — 1–1024 characters
 * (`API_S3VectorBuckets_GetVectors.html`, *keys*) — and must be a string AWS can
 * decode (T3-15). Unlike a write or a delete, a repeated id is fine: it is
 * fetched once and answered in every slot that asked for it.
 */
function accepts([ids, options]: GetByIdsInput): boolean {
  if (!isKeyList(ids)) return false;
  if (isAbsent(options)) return true;
  return (
    isRecord(options) &&
    isOptionalIntegerUpTo(options['batchSize'], MAX_GET_BATCH_SIZE) &&
    isOptionalSignal(options['signal'])
  );
}

function cases(): readonly ContractCase<GetByIdsInput>[] {
  const built: ContractCase<GetByIdsInput>[] = [];

  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `ids = ${value.label}`,
      input: [value.make(), undefined],
      ambient: BENIGN,
    });
    built.push({
      label: `options = ${value.label}`,
      input: [['k1'], value.make()],
      ambient: BENIGN,
    });
    built.push({
      label: `options.batchSize = ${value.label}`,
      input: [['k1'], { batchSize: value.make() }],
      ambient: BENIGN,
    });
    built.push({
      label: `options.signal = ${value.label}`,
      input: [['k1'], { signal: value.make() }],
      ambient: BENIGN,
    });
  }

  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid fetch under "${ambient.label}"`,
      input: [['k1', 'k2'], undefined],
      ambient,
    });
  }

  built.push({
    label: 'a repeated id is allowed',
    input: [['same', 'same'], undefined],
    ambient: BENIGN,
  });
  built.push({
    label: 'an already-fired signal aborts',
    input: [['k1'], { signal: AbortSignal.abort() }],
    ambient: BENIGN,
  });
  built.push({
    label: 'an id with an unpaired surrogate is refused',
    input: [['k\ud800'], undefined],
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
/** What a failed fetch carries, so a caller need not refetch what already arrived. */
const FETCH_FAILURE = [...SCOPE, 'foundIds'];
/** A failed `GetVectors` request also names the request. */
const REQUEST_FAILURE = [...FETCH_FAILURE, 'awsCommand'];

/** The executable contract for `AmazonS3Vectors.getByIds`. */
export const getByIdsContract: EntryPointContract<GetByIdsInput> = {
  symbol: 'AmazonS3Vectors.getByIds',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.THROTTLED,
    S3VectorsErrorCode.ACCESS_DENIED,
    S3VectorsErrorCode.AWS_REJECTED,
    S3VectorsErrorCode.NOT_FOUND,
    S3VectorsErrorCode.SERVICE_UNAVAILABLE,
    S3VectorsErrorCode.KMS_ERROR,
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
    S3VectorsErrorCode.AWS_INVALID_RESPONSE,
  ]),
  requiredContext: {
    [S3VectorsErrorCode.VALIDATION]: SCOPE,
    [S3VectorsErrorCode.ABORTED]: SCOPE,
    [S3VectorsErrorCode.THROTTLED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.ACCESS_DENIED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REJECTED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.NOT_FOUND]: REQUEST_FAILURE,
    [S3VectorsErrorCode.SERVICE_UNAVAILABLE]: REQUEST_FAILURE,
    [S3VectorsErrorCode.KMS_ERROR]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_REQUEST_FAILED]: REQUEST_FAILURE,
    [S3VectorsErrorCode.AWS_INVALID_RESPONSE]: FETCH_FAILURE,
  },
  accepts,
  invoke: async (store: AmazonS3Vectors, [ids, options]: GetByIdsInput) =>
    await store.getByIds(ids as string[], options as Parameters<AmazonS3Vectors['getByIds']>[1]),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs'],
};
