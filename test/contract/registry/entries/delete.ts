import { S3VectorsErrorCode } from '../../../../src/shared/errors/error-code.js';
import { AMBIENTS, HOSTILE_VALUES } from '../corpus.js';
import type { Ambient } from '../harness.js';
import type { ContractCase, EntryPointContract } from '../types.js';

const BENIGN = AMBIENTS[0] as Ambient;

/** A vector key is 1–1024 characters (`API_S3VectorBuckets_PutInputVector.html`). */
const KEY_MAX_LENGTH = 1024;
/** "Keys per DeleteVectors call: 500" (limits page). */
const MAX_BATCH_SIZE = 500;

/** The store's default `maxConcurrentBatchCalls`. */
const DEFAULT_MAX_CONCURRENT = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortSignalLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { aborted?: unknown; addEventListener?: unknown };
  return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

/**
 * What `delete` accepts, stated from the contract rather than from the code.
 *
 * Deliberately *not* a call into `assertIdsWellFormed`: a domain test that
 * delegates to the validator under test can only ever agree with it. The one
 * difference from the write path is on purpose — a repeated id is accepted
 * here, because deleting the same key twice is idempotent, whereas writing the
 * same key twice silently discards a document.
 */
function accepts(input: unknown): boolean {
  if (!isPlainObject(input)) return false;
  if (input['deleteAll'] !== undefined) return false;

  const ids: unknown = input['ids'];
  if (!Array.isArray(ids)) return false;
  for (const id of ids as unknown[]) {
    if (typeof id !== 'string' || id.length < 1 || id.length > KEY_MAX_LENGTH) return false;
  }

  // `null` means "not provided" throughout this package — the store reads a
  // `null` client and a `null` filter that way, and `batchSize ?? 500` gives
  // `null` the default. An optional field a DI framework defaulted to `null` is
  // an absent field, not a malformed one, and the contract says so here rather
  // than leaving each call site to decide.
  const batchSize: unknown = input['batchSize'];
  if (batchSize !== undefined && batchSize !== null) {
    if (!Number.isInteger(batchSize)) return false;
    const size = batchSize as number;
    if (size < 1 || size > MAX_BATCH_SIZE) return false;
  }

  const signal: unknown = input['signal'];
  if (signal !== undefined && signal !== null && !isAbortSignalLike(signal)) return false;

  return true;
}

function cases(): readonly ContractCase<unknown>[] {
  const built: ContractCase<unknown>[] = [];

  // The whole params bag, hostile.
  for (const value of HOSTILE_VALUES) {
    built.push({ label: `params = ${value.label}`, input: value.make(), ambient: BENIGN });
  }

  // `ids`, hostile — the parameter the audit found forwarded unvalidated.
  for (const value of HOSTILE_VALUES) {
    built.push({ label: `ids = ${value.label}`, input: { ids: value.make() }, ambient: BENIGN });
  }

  // `batchSize`, hostile, with a valid id list so the batch size is what fails.
  for (const value of HOSTILE_VALUES) {
    built.push({
      label: `batchSize = ${value.label}`,
      input: { ids: ['k1'], batchSize: value.make() },
      ambient: BENIGN,
    });
  }

  // `signal`, hostile.
  for (const value of HOSTILE_VALUES) {
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

  // Cases with an answer that is not "reject": the empty list issues no
  // request, and a repeated key is idempotent.
  built.push({ label: 'ids = [] issues no request', input: { ids: [] }, ambient: BENIGN });
  built.push({
    label: 'ids with a repeat is idempotent',
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

  return built;
}

/** The executable contract for `AmazonS3Vectors.delete`. */
export const deleteContract: EntryPointContract<unknown> = {
  symbol: 'AmazonS3Vectors.delete',
  docSource: 'src/s3-vectors.ts:delete',
  mayThrow: new Set([
    S3VectorsErrorCode.VALIDATION,
    S3VectorsErrorCode.ABORTED,
    S3VectorsErrorCode.THROTTLED,
    S3VectorsErrorCode.ACCESS_DENIED,
    S3VectorsErrorCode.AWS_REJECTED,
    S3VectorsErrorCode.NOT_FOUND,
    S3VectorsErrorCode.SERVICE_UNAVAILABLE,
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
  ]),
  requiredContext: {
    [S3VectorsErrorCode.VALIDATION]: ['vectorBucketName', 'indexName'],
    [S3VectorsErrorCode.ABORTED]: ['vectorBucketName', 'indexName'],
    [S3VectorsErrorCode.THROTTLED]: ['vectorBucketName', 'indexName', 'deletedIds'],
    [S3VectorsErrorCode.ACCESS_DENIED]: ['vectorBucketName', 'indexName', 'deletedIds'],
    [S3VectorsErrorCode.AWS_REJECTED]: ['vectorBucketName', 'indexName', 'deletedIds'],
    [S3VectorsErrorCode.NOT_FOUND]: ['vectorBucketName', 'indexName', 'deletedIds'],
    [S3VectorsErrorCode.SERVICE_UNAVAILABLE]: ['vectorBucketName', 'indexName', 'deletedIds'],
    [S3VectorsErrorCode.AWS_REQUEST_FAILED]: ['vectorBucketName', 'indexName', 'deletedIds'],
  },
  accepts,
  invoke: async (store, input) => await store.delete(input as Parameters<typeof store.delete>[0]),
  cases,
  maxConcurrency: DEFAULT_MAX_CONCURRENT,
  guarantees: ['does-not-mutate-inputs'],
};
