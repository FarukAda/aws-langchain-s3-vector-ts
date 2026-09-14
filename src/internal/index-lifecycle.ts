import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  type EncryptionConfiguration,
  type S3VectorsClient,
} from '@aws-sdk/client-s3vectors';

import { isAwsConflictException } from '../shared/errors/aws-conflict.js';
import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { DistanceMetric, VectorDataType } from '../types.js';
import { checkAborted, raceAbort } from './signals.js';

/** The client and the index a lifecycle call acts on. */
export interface IndexContext {
  /** The client the control-plane calls go through. */
  readonly client: S3VectorsClient;
  /** The vector bucket the index lives in. */
  readonly vectorBucketName: string;
  /** The index this tracker is responsible for. */
  readonly indexName: string;
}

/**
 * Whether the configured index exists.
 *
 * Accepts:
 * - `ctx` — the client, bucket and index name.
 * - `signal` — absent, or an `AbortSignal`. Already fired: rejects before any
 *   request is issued. Fires in flight: the request is cancelled.
 *
 * Returns: `true` when `GetIndex` resolves, `false` when it fails
 * `NotFoundException`
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetIndex.html).
 *
 * Throws: `ABORTED` for `signal`; otherwise the class {@link classifyAwsError}
 * assigns.
 *
 * Guarantees: reads no field of the response, so a non-conforming body cannot
 * change the answer — existence is proven by the 200, not by the body.
 */
export async function indexExists(ctx: IndexContext, signal?: AbortSignal): Promise<boolean> {
  checkAborted('GetIndex', signal, ctx);
  try {
    await ctx.client.send(
      new GetIndexCommand({
        vectorBucketName: ctx.vectorBucketName,
        indexName: ctx.indexName,
      }),
      { abortSignal: signal },
    );
    return true;
  } catch (error: unknown) {
    if (isAwsNotFoundException(error)) return false;
    throw wrapAwsError(error, classifyAwsError(error), {
      operation: 'GetIndex',
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  }
}

/** The index attributes a newly created index is given. */
export interface IndexLifecycleConfig {
  /**
   * The vector data type a created index is given. Every field here is read
   * only at creation: S3 Vectors has no `UpdateIndex`, so an existing index is
   * never reconfigured from this.
   */
  readonly dataType: VectorDataType;
  /** The distance metric a created index is given. Fixed at creation. */
  readonly distanceMetric: DistanceMetric;
  /** Added to the non-filterable keys, so page content never spends the filterable budget. */
  readonly pageContentMetadataKey: string | null;
  /** Keys a created index excludes from filters; at most 10 including the page-content key. */
  readonly nonFilterableMetadataKeys?: readonly string[] | undefined;
  /** Server-side encryption for a created index. Cannot be changed afterwards. */
  readonly encryptionConfiguration?: EncryptionConfiguration | undefined;
  /** Tags for a created index. Supplying any also requires `s3vectors:TagResource`. */
  readonly tags?: Record<string, string> | undefined;
}

/** Existence tracking for one index, with its memo and flag kept private. */
export interface IndexLifecycle {
  /**
   * Ensure the index exists, creating it at `dimension` if it does not.
   *
   * Accepts:
   * - `dimension` — used only when an index is created; ignored when one is
   *   already there.
   * - `signal` — makes this caller's own wait reject early. It never cancels
   *   the shared `GetIndex`/`CreateIndex` work, because other callers depend
   *   on it.
   *
   * Returns: nothing. Existence is the entire result.
   *
   * Throws: `ABORTED` for `signal`; otherwise the class `classifyAwsError`
   * assigns. A `ConflictException` from `CreateIndex` is not an error — it
   * means another process created the index first, which is the requested
   * state
   * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html).
   *
   * Guarantees: on resolution the index existed at some point during this
   * call. Concurrent callers share one request sequence. Existence is
   * remembered only on resolution, never on failure.
   */
  ensureExists(dimension: number, signal?: AbortSignal): Promise<void>;

  /**
   * Delete the index and everything in it.
   *
   * Accepts:
   * - `signal` — absent, or an `AbortSignal`. Already fired: rejects before the
   *   in-flight creation is awaited and before any request.
   *
   * Returns: nothing.
   *
   * Throws: `ABORTED` for `signal`; otherwise the class `classifyAwsError`
   * assigns, except a response reporting the index absent, which resolves —
   * the requested state already holds. AWS returns a 404 `NotFoundException`
   * for an index that is already gone (docs/evidence/delete-absent.md), so
   * resolving is this package's decision, not the service's.
   *
   * Guarantees: an index creation already in flight completes before the
   * deletion is issued, so no in-flight creation can outlive this call. A
   * write that starts after this call begins may re-create the index; last
   * operation wins.
   */
  deleteIndex(signal?: AbortSignal): Promise<void>;

  /**
   * Forget that the index exists, so the next {@link ensureExists} re-checks.
   *
   * Called when a data-plane request reports the index missing — an index
   * deleted out of band, by an ops script or another process. Without it every
   * later write would skip the check and fail the same way for the life of the
   * process.
   */
  markAbsent(): void;
}

/** AWS limits, every one documented; see docs/DESIGN.md §9. */
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;
const MAX_NON_FILTERABLE_KEYS = 10;
const NON_FILTERABLE_KEY_MIN = 1;
const NON_FILTERABLE_KEY_MAX = 63;
const TAG_KEY_MIN = 1;
const TAG_KEY_MAX = 128;
const TAG_VALUE_MIN = 0;
const TAG_VALUE_MAX = 256;

/**
 * The non-filterable keys a created index is given.
 *
 * Accepts: the store's `nonFilterableMetadataKeys` and its
 * `pageContentMetadataKey` (`null` when page content is not stored at all).
 *
 * Returns: the configured list plus the page-content key, which must not be
 * filterable — filterable metadata is capped at 2 KB against 40 KB total
 * (limits page), and page content is prose nobody filters by. Duplicates
 * collapse, so a caller who already listed the key gets no second copy, and
 * the caller's array is not mutated.
 *
 * Throws: nothing. The 10-key ceiling is enforced at creation, where the
 * error can name the index being created.
 */
export function nonFilterableKeys(config: IndexLifecycleConfig): string[] {
  const configured = config.nonFilterableMetadataKeys ?? [];
  return config.pageContentMetadataKey === null
    ? [...configured]
    : [...new Set([...configured, config.pageContentMetadataKey])];
}

/**
 * The non-filterable keys a new index may be created with.
 *
 * @throws {S3VectorsError} `VALIDATION` for more than 10 keys, or a key
 * outside 1–63 characters (limits page). Checked before `CreateIndex` so the
 * failure names the configuration rather than arriving as an opaque rejection.
 */
function assertKeysCreatable(keys: readonly string[], fail: (message: string) => never): void {
  if (keys.length > MAX_NON_FILTERABLE_KEYS) {
    fail(
      `An index may have at most ${MAX_NON_FILTERABLE_KEYS} non-filterable metadata keys; this configuration needs ${keys.length}.`,
    );
  }
  for (const key of keys) {
    if (key.length < NON_FILTERABLE_KEY_MIN || key.length > NON_FILTERABLE_KEY_MAX) {
      fail(
        `Non-filterable metadata key ${JSON.stringify(key)} must be ${NON_FILTERABLE_KEY_MIN}-${NON_FILTERABLE_KEY_MAX} characters.`,
      );
    }
  }
}

/**
 * The tags a new index may be created with.
 *
 * @throws {S3VectorsError} `VALIDATION` for a key outside 1–128 characters or
 * a value outside 0–256 (`CreateIndex` API reference).
 */
function assertTagsCreatable(
  tags: Record<string, string> | undefined,
  fail: (message: string) => never,
): void {
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (key.length < TAG_KEY_MIN || key.length > TAG_KEY_MAX) {
      fail(`Tag key ${JSON.stringify(key)} must be ${TAG_KEY_MIN}-${TAG_KEY_MAX} characters.`);
    }
    if (value.length < TAG_VALUE_MIN || value.length > TAG_VALUE_MAX) {
      fail(
        `Tag value for ${JSON.stringify(key)} must be ${TAG_VALUE_MIN}-${TAG_VALUE_MAX} characters.`,
      );
    }
  }
}

/**
 * Everything AWS requires of an index before it can be created.
 *
 * @throws {S3VectorsError} `VALIDATION` for a dimension outside 1–4096, more
 * than 10 non-filterable keys, or a key or tag outside its documented bounds.
 * An index's dimension, metric and non-filterable keys are fixed at creation
 * (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-indexes.html),
 * so a rejected configuration must never reach the service: the index it would
 * leave behind could not be corrected afterwards.
 */
function assertCreatable(
  ctx: IndexContext,
  dimension: number,
  keys: readonly string[],
  tags: Record<string, string> | undefined,
): void {
  const fail = (message: string): never => {
    throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
      operation: 'createIndex',
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  };

  if (!Number.isInteger(dimension) || dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) {
    fail(
      `dimension must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION} (received ${String(dimension)}).`,
    );
  }
  assertKeysCreatable(keys, fail);
  assertTagsCreatable(tags, fail);
}

/**
 * Create the index at `dimension`, from this store's configuration.
 *
 * Accepts: the index to create and the configuration to create it from. No
 * signal, deliberately: the only caller is the shared memo, so no single
 * caller may cancel it out from under the others.
 *
 * Returns: nothing, both when this call created the index and when another
 * writer did first — a `ConflictException` means the requested state was
 * reached, not that anything failed
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html).
 *
 * Throws: `VALIDATION` for a dimension, key set or tag set AWS would reject,
 * before the request; otherwise the class the failure maps to.
 *
 * Guarantees: optional members are omitted rather than sent as `undefined`, so
 * a store that configures none creates the index AWS's own defaults would.
 */
async function createIndex(
  ctx: IndexContext,
  config: IndexLifecycleConfig,
  dimension: number,
): Promise<void> {
  const keys = nonFilterableKeys(config);
  assertCreatable(ctx, dimension, keys, config.tags);
  try {
    await ctx.client.send(
      new CreateIndexCommand({
        vectorBucketName: ctx.vectorBucketName,
        indexName: ctx.indexName,
        dataType: config.dataType,
        dimension,
        distanceMetric: config.distanceMetric,
        ...(keys.length > 0 ? { metadataConfiguration: { nonFilterableMetadataKeys: keys } } : {}),
        ...(config.encryptionConfiguration !== undefined
          ? { encryptionConfiguration: config.encryptionConfiguration }
          : {}),
        ...(config.tags !== undefined ? { tags: config.tags } : {}),
      }),
    );
  } catch (error: unknown) {
    if (isAwsConflictException(error)) return;
    throw wrapAwsError(error, classifyAwsError(error), {
      operation: 'CreateIndex',
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  }
}

/**
 * Build the existence tracker for one index.
 *
 * Accepts: the client and the index it acts on, plus the configuration a
 * created index is built from (`dataType`, `distanceMetric`,
 * `pageContentMetadataKey`, `nonFilterableMetadataKeys`,
 * `encryptionConfiguration`, `tags`). The configuration is read only when an
 * index is created; an existing one is never reconfigured, because S3 Vectors
 * has no `UpdateIndex`.
 *
 * Returns: an {@link IndexLifecycle}. Each method carries its own contract.
 *
 * Throws: nothing. Constructing the tracker issues no request.
 *
 * Guarantees, all of them properties of the closed-over state rather than of
 * any single method:
 * - The "this index exists" flag and the in-flight creation promise are
 *   private. No caller can set the flag, which is what makes it safe to skip
 *   `GetIndex` on every write after the first.
 * - Existence is remembered only on resolution, never on failure, so a failed
 *   creation is retried rather than assumed.
 * - Concurrent callers share one creation attempt (the memo), so twenty
 *   parallel writes issue one `GetIndex` and at most one `CreateIndex`.
 * - `deleteIndex` awaits an in-flight creation before deleting, so a creation
 *   that started first can never land afterwards and resurrect the index.
 * - Nothing about an existing index is cached beyond its existence: AWS
 *   enforces the dimension on every write and the metric is checked on every
 *   read, so there is no stale descriptor to go wrong (DESIGN.md D-9).
 */
export function createIndexLifecycle(
  ctx: IndexContext,
  config: IndexLifecycleConfig,
): IndexLifecycle {
  let knownToExist = false;
  let memo: Promise<void> | null = null;

  return {
    async ensureExists(dimension: number, signal?: AbortSignal): Promise<void> {
      checkAborted('ensureIndexExists', signal, ctx);
      if (knownToExist) return;

      memo ??= (async () => {
        try {
          if (!(await indexExists(ctx))) await createIndex(ctx, config, dimension);
          knownToExist = true;
        } finally {
          memo = null;
        }
      })();

      // The memo is shared, so the wait is raced rather than the work
      // cancelled: one caller's abort must not cancel a creation the others
      // are waiting on (DESIGN.md §7.2).
      const shared = memo;
      await raceAbort(() => shared, signal, 'ensureIndexExists', ctx);
    },

    markAbsent(): void {
      knownToExist = false;
    },

    async deleteIndex(signal?: AbortSignal): Promise<void> {
      checkAborted('DeleteIndex', signal, ctx);

      // Serialise behind any creation already running. Without this, a
      // creation that started before this delete settles after it and
      // re-creates the index — the defect the epoch counter was originally
      // added to prevent (DESIGN.md D-30). Its outcome is irrelevant here:
      // a failed creation still leaves nothing to wait for.
      if (memo) await memo.catch(() => undefined);

      try {
        await ctx.client.send(
          new DeleteIndexCommand({
            vectorBucketName: ctx.vectorBucketName,
            indexName: ctx.indexName,
          }),
          { abortSignal: signal },
        );
      } catch (error: unknown) {
        if (!isAwsNotFoundException(error)) {
          throw wrapAwsError(error, classifyAwsError(error), {
            operation: 'DeleteIndex',
            vectorBucketName: ctx.vectorBucketName,
            indexName: ctx.indexName,
          });
        }
      }
      knownToExist = false;
    },
  };
}
