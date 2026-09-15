import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  type EncryptionConfiguration,
  type S3VectorsClient,
} from '@aws-sdk/client-s3vectors';

import { renderValue } from '../shared/describe.js';
import { isAwsConflictException } from '../shared/errors/aws-conflict.js';
import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { DistanceMetric, VectorDataType } from '../types.js';
import { checkAborted, raceAbort, sendOptions } from './signals.js';

/** The client and the index a lifecycle call acts on. */
export interface IndexContext {
  /** The client the control-plane calls go through. */
  readonly client: S3VectorsClient;
  /** The vector bucket the index lives in. */
  readonly vectorBucketName: string;
  /** The index this tracker is responsible for. */
  readonly indexName: string;
}

/** What a `GetIndex` call established about the index. */
export interface IndexDescription {
  /** Whether the index is there, proven by the response status alone. */
  readonly exists: boolean;
  /**
   * The index's own non-filterable metadata keys, when the response carried a
   * recognisable list. `undefined` means "not stated", never "none" — a body
   * this package cannot read must not be reported as a configuration.
   */
  readonly nonFilterableKeys?: readonly string[];
}

/**
 * The index's own non-filterable keys, if the response stated them.
 *
 * Accepts: a `GetIndex` response, in whatever shape it arrived.
 *
 * Returns: the list the index reported; `[]` when the response carried an
 * index and simply named no keys; `undefined` only when the response is not one
 * this package can read at all, which is "unknown", not "none".
 *
 * That distinction is a measured fact rather than a guess. AWS **omits**
 * `metadataConfiguration` altogether for an index that has no non-filterable
 * keys, and includes it when it has them — probed against the live service on
 * an ephemeral bucket:
 *
 *     probe-nokeys      hasOwn(metadataConfiguration)=false  value=undefined
 *     probe-withkeys    hasOwn(metadataConfiguration)=true   value={"nonFilterableMetadataKeys":["_page_content"]}
 *
 * So on a conforming response an absent configuration states that the index has
 * none — which is exactly the case worth catching, an index created by the
 * console or the CLI and then written to by a default store that expects its
 * page-content key to be non-filterable. Treating absence as "unknown" would
 * skip the check precisely where it matters most.
 *
 * A response with no readable `index` is different: nothing was stated, and a
 * mocked client or an incompatible SDK version must not be able to manufacture
 * a configuration mismatch out of a body this package cannot parse.
 *
 * Throws: nothing. Every read is shape-checked, because this must never be able
 * to turn a live index into a failure: existence is the answer that matters, and
 * it is settled before this is consulted.
 */
function nonFilterableKeysOf(response: unknown): readonly string[] | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const index: unknown = (response as { index?: unknown }).index;
  if (typeof index !== 'object' || index === null) return undefined;

  // An absent `metadataConfiguration` is only evidence of "no keys" when the
  // rest of the body is recognisably an index description. `indexName` is a
  // required member of `Index`, so a body lacking it is not one this package
  // can read a configuration out of — and a stubbed or half-built response must
  // not be able to manufacture a mismatch out of what it failed to say.
  if (typeof (index as { indexName?: unknown }).indexName !== 'string') return undefined;

  const configuration: unknown = (index as { metadataConfiguration?: unknown })
    .metadataConfiguration;
  if (configuration === undefined || configuration === null) return [];
  if (typeof configuration !== 'object') return undefined;

  const keys: unknown = (configuration as { nonFilterableMetadataKeys?: unknown })
    .nonFilterableMetadataKeys;
  if (keys === undefined || keys === null) return [];
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) return undefined;
  return keys;
}

/**
 * Whether the configured index exists, and how it is configured.
 *
 * Accepts:
 * - `ctx` — the client, bucket and index name.
 * - `signal` — absent, or an `AbortSignal`. Already fired: rejects before any
 *   request is issued. Fires in flight: the request is cancelled.
 *
 * Returns: `exists: true` when `GetIndex` resolves, `exists: false` when it
 * fails `NotFoundException`
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetIndex.html),
 * plus the index's non-filterable keys when the response stated them.
 *
 * Throws: `ABORTED` for `signal`; otherwise the class {@link classifyAwsError}
 * assigns.
 *
 * Guarantees: **existence is still proven by the 200, never by the body.** The
 * body is read only to add what it happens to say, through shape checks that
 * fall back to `undefined`, so a non-conforming response reports an existing
 * index with an unknown configuration rather than becoming an error or, worse,
 * an index this package would try to create a second time.
 */
export async function describeIndex(
  ctx: IndexContext,
  signal?: AbortSignal,
): Promise<IndexDescription> {
  checkAborted('GetIndex', signal, ctx);
  try {
    const response = await ctx.client.send(
      new GetIndexCommand({
        vectorBucketName: ctx.vectorBucketName,
        indexName: ctx.indexName,
      }),
      sendOptions(signal),
    );
    const keys = nonFilterableKeysOf(response);
    return keys === undefined ? { exists: true } : { exists: true, nonFilterableKeys: keys };
  } catch (error: unknown) {
    if (isAwsNotFoundException(error)) return { exists: false };
    throw wrapAwsError(error, classifyAwsError(error), {
      operation: 'GetIndex',
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  }
}

/**
 * Refuse a write to an index that disagrees with this store's configuration.
 *
 * Accepts: the keys the index reported (`undefined` when it stated none), and
 * the keys this store would have created it with — its
 * `nonFilterableMetadataKeys` plus its `pageContentMetadataKey`.
 *
 * Returns: nothing when they agree as sets, or when the index stated nothing
 * and there is therefore nothing to compare.
 *
 * Throws: {@link S3VectorsError} with code `INDEX_CONFIG_MISMATCH`, naming both
 * sets and the difference.
 *
 * Guarantees: order is ignored, carrying no meaning at AWS or here.
 *
 * This exists because the same option decides two different things: which keys
 * a created index excludes from filters, and which keys the local 2 KB
 * filterable-metadata budget leaves out. Only the first was ever checked
 * against the index. When they disagree the budget is computed against the
 * wrong set and fails in both directions — a store whose list falls short of
 * the index's refuses writes AWS would accept, and one whose list runs longer
 * sends writes AWS refuses, after the embedding has been paid for. Verified
 * live: the same 3,000-byte value was rejected on an index that did not declare
 * its key non-filterable and accepted on one that did.
 *
 * It is checked here, against the response this package already asks for,
 * exactly as `distanceMetric` is checked against every first query page — and
 * for the same reason, that an index configured out of band should be caught
 * rather than silently written to under the wrong assumptions.
 */
function assertKeysAgree(
  reported: readonly string[] | undefined,
  expected: readonly string[],
  ctx: IndexContext,
  operation: string,
): void {
  if (reported === undefined) return;

  const onIndex = new Set(reported);
  const onStore = new Set(expected);
  const missing = [...onStore].filter((key) => !onIndex.has(key));
  const extra = [...onIndex].filter((key) => !onStore.has(key));
  if (missing.length === 0 && extra.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `the index does not treat ${missing.map((k) => JSON.stringify(k)).join(', ')} as ` +
        'non-filterable, so those values count against its 2 KB filterable budget',
    );
  }
  if (extra.length > 0) {
    parts.push(
      `the index treats ${extra.map((k) => JSON.stringify(k)).join(', ')} as non-filterable, ` +
        'which this store does not, so it is budgeting as though they were filterable',
    );
  }

  throw new S3VectorsError(
    `Index "${ctx.indexName}" and this store disagree about which metadata keys are ` +
      `non-filterable: ${parts.join('; and ')}. The index has ` +
      `[${[...onIndex].map((k) => JSON.stringify(k)).join(', ')}] and this store is configured ` +
      `for [${[...onStore].map((k) => JSON.stringify(k)).join(', ')}]. A non-filterable key ` +
      'set is fixed when the index is created and cannot be changed, so align ' +
      '`nonFilterableMetadataKeys` (and `pageContentMetadataKey`, which is added to it) with ' +
      'the index, or write to an index created with this configuration.',
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    { operation, vectorBucketName: ctx.vectorBucketName, indexName: ctx.indexName },
  );
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
  ensureExists(
    dimension: number,
    signal: AbortSignal | undefined,
    operation: string,
  ): Promise<void>;

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
  deleteIndex(signal: AbortSignal | undefined, operation: string): Promise<void>;

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

/** AWS limits, every one documented on the S3 Vectors limitations page. */
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
      `dimension must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION} (received ${renderValue(dimension)}).`,
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
 *   read, so there is no stale descriptor to go wrong.
 */
export function createIndexLifecycle(
  ctx: IndexContext,
  config: IndexLifecycleConfig,
): IndexLifecycle {
  let knownToExist = false;
  let memo: Promise<void> | null = null;

  return {
    async ensureExists(
      dimension: number,
      signal: AbortSignal | undefined,
      operation: string,
    ): Promise<void> {
      checkAborted(operation, signal, ctx);
      if (knownToExist) return;

      memo ??= (async () => {
        try {
          const description = await describeIndex(ctx);
          if (description.exists) {
            // Only for an index this store did not create. One it creates is
            // configured from this very list, so it agrees by construction.
            assertKeysAgree(
              description.nonFilterableKeys,
              nonFilterableKeys(config),
              ctx,
              operation,
            );
          } else {
            await createIndex(ctx, config, dimension);
          }
          knownToExist = true;
        } finally {
          memo = null;
        }
      })();

      // The memo is shared, so the wait is raced rather than the work
      // cancelled: one caller's abort must not cancel a creation the others
      // are waiting on.
      const shared = memo;
      await raceAbort(() => shared, signal, operation, ctx);
    },

    markAbsent(): void {
      knownToExist = false;
    },

    async deleteIndex(signal: AbortSignal | undefined, operation: string): Promise<void> {
      checkAborted(operation, signal, ctx);

      // Serialise behind any creation already running. Without this, a
      // creation that started before this delete settles after it and
      // re-creates the index. Its outcome is irrelevant here: a failed creation
      // still leaves nothing to wait for.
      //
      // Raced against the signal rather than simply awaited. The creation is
      // shared, so one caller may not cancel it — but this caller's *wait* is
      // their own, and the documented promise is that the signal ends it early.
      // Plainly awaited, an abort did nothing until the creation finished, and
      // `DeleteIndex` was then issued anyway with an already-aborted signal.
      if (memo) {
        const settled = memo.catch(() => undefined);
        await raceAbort(() => settled, signal, operation, ctx);
      }

      try {
        await ctx.client.send(
          new DeleteIndexCommand({
            vectorBucketName: ctx.vectorBucketName,
            indexName: ctx.indexName,
          }),
          sendOptions(signal),
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
