import type { AmazonS3Vectors } from '../../../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import {
  DEFAULT_MAX_CONCURRENT,
  isOptionalIntegerUpTo,
  isOptionalSignal,
  isRecord,
  isUniqueKeyList,
  MAX_DELETE_BATCH_SIZE,
} from '../domain.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/**
 * What `delete` accepts, stated from the contract rather than from the code.
 *
 * This once accepted a repeated id, reasoning that deleting the same key twice
 * is idempotent. It is not: `DeleteVectors` answers a request that repeats a key
 * with "Request must not contain duplicate keys", probed against the live
 * service. So the id rule is the write path's, duplicates included.
 */
function accepts(input: unknown): boolean {
  if (!isRecord(input) || input['deleteAll'] !== undefined) return false;
  return (
    isUniqueKeyList(input['ids']) &&
    isOptionalIntegerUpTo(input['batchSize'], MAX_DELETE_BATCH_SIZE) &&
    isOptionalSignal(input['signal'])
  );
}

function cases(): readonly ContractCase<unknown>[] {
  const built: ContractCase<unknown>[] = [];

  for (const value of HOSTILE_VALUES) {
    built.push({ label: `params = ${value.label}`, input: value.make(), ambient: BENIGN });
    built.push({ label: `ids = ${value.label}`, input: { ids: value.make() }, ambient: BENIGN });
    built.push({
      label: `batchSize = ${value.label}`,
      input: { ids: ['k1'], batchSize: value.make() },
      ambient: BENIGN,
    });
    built.push({
      label: `signal = ${value.label}`,
      input: { ids: ['k1'], signal: value.make() },
      ambient: BENIGN,
    });
  }

  // A valid call under every ambient condition — this is what makes the
  // declared error codes reachable.
  for (const ambient of AMBIENTS) {
    built.push({
      label: `valid delete under "${ambient.label}"`,
      input: { ids: ['k1', 'k2'] },
      ambient,
    });
  }

  built.push({ label: 'ids = [] issues no request', input: { ids: [] }, ambient: BENIGN });
  built.push({
    label: 'a repeated id is refused, as DeleteVectors refuses it',
    input: { ids: ['same', 'same'] },
    ambient: BENIGN,
  });
  built.push({
    label: 'an already-fired signal aborts',
    input: { ids: ['k1'], signal: AbortSignal.abort() },
    ambient: BENIGN,
  });
  built.push({
    label: 'deleteAll is refused',
    input: { ids: ['k1'], deleteAll: true },
    ambient: BENIGN,
  });
  built.push({
    label: 'an id with an unpaired surrogate is refused',
    input: { ids: ['k\ud800'] },
    ambient: BENIGN,
  });

  return built;
}

const SCOPE = ['vectorBucketName', 'indexName'];
const DELETE_FAILURE = [...SCOPE, 'deletedIds'];
/** A failed `DeleteVectors` request also names the request. */
const REQUEST_FAILURE = [...DELETE_FAILURE, 'awsCommand'];

/** The executable contract for `AmazonS3Vectors.delete`. */
export const deleteContract: EntryPointContract<unknown> = {
  symbol: 'AmazonS3Vectors.delete',
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
  },
  accepts,
  invoke: async (store: AmazonS3Vectors, input: unknown) =>
    await store.delete(input as Parameters<AmazonS3Vectors['delete']>[0]),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs'],
};
