/**
 * Hides whether the index is there yet.
 *
 * A first write may have to create the index, and several writes starting at
 * once must not each try. One shared check per store, its result cached, the
 * race resolved so that every waiter is answered under its own operation name —
 * that is the decision. Callers write; they never ask whether the index exists.
 */
import {
  CreateIndexCommand,
  DeleteIndexCommand,
  GetIndexCommand,
  GetVectorBucketCommand,
  type EncryptionConfiguration,
  type S3VectorsClient,
} from '@aws-sdk/client-s3vectors';

import {
  isTagKeyLength,
  isTagValueLength,
  MAX_DIMENSION,
  MAX_NON_FILTERABLE_KEYS,
  METADATA_KEY_MAX_LENGTH,
  METADATA_KEY_MIN_LENGTH,
  MIN_DIMENSION,
  TAG_KEY_MAX_LENGTH,
  TAG_KEY_MIN_LENGTH,
  TAG_VALUE_MAX_LENGTH,
  TAG_VALUE_MIN_LENGTH,
} from '../shared/aws-limits.js';
import { renderValue } from '../shared/describe.js';
import { isAwsConflictException } from '../shared/errors/aws-conflict.js';
import { isAwsNotFoundException } from '../shared/errors/aws-not-found.js';
import { classifyAwsError } from '../shared/errors/classify.js';
import { attachOperation, rebuildWithContext } from '../shared/errors/decorate.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { wrapAwsError } from '../shared/errors/wrap-error.js';
import type { StoreScope } from '../shared/scope.js';
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
  readonly nonFilterableMetadataKeys?: readonly string[];
  /** The index's own distance metric, when the response stated a recognisable one. */
  readonly distanceMetric?: DistanceMetric;
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
function nonFilterableMetadataKeysOf(response: unknown): readonly string[] | undefined {
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
 * The index's own distance metric, if the response stated a recognisable one.
 *
 * Accepts: a `GetIndex` response, in whatever shape it arrived.
 *
 * Returns: whichever of the two the body recognisably carried. A field is
 * omitted rather than guessed, so a body this package cannot parse states
 * nothing — the same rule {@link nonFilterableMetadataKeysOf} follows, and for
 * the same reason: a mocked client or an incompatible SDK version must not be
 * able to manufacture a configuration mismatch out of what it failed to say.
 *
 * Throws: nothing. Existence is the answer that matters and is already settled
 * before this is consulted.
 */
function indexShapeOf(response: unknown): { distanceMetric?: DistanceMetric } {
  if (typeof response !== 'object' || response === null) return {};
  const index: unknown = (response as { index?: unknown }).index;
  if (typeof index !== 'object' || index === null) return {};

  const metric: unknown = (index as { distanceMetric?: unknown }).distanceMetric;
  return {
    ...(metric === 'cosine' || metric === 'euclidean' ? { distanceMetric: metric } : {}),
  };
}

/**
 * Whether the configured index exists, and how it is configured.
 *
 * Accepts:
 * - `ctx` — the client, bucket and index name.
 * - `signal` — `undefined`, or an `AbortSignal`. Already fired: rejects before
 *   any request is issued. Fires in flight: the request is cancelled.
 * - `operation` — the public method the check is for, named in any error.
 *
 * Returns: `exists: true` when `GetIndex` resolves, `exists: false` when it
 * fails `NotFoundException`
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetIndex.html),
 * plus the index's non-filterable keys when the response stated them.
 *
 * Throws: `ABORTED` for `signal`, naming `operation` and no request;
 * otherwise the class {@link classifyAwsError} assigns, carrying
 * `awsCommand: "GetIndex"`.
 *
 * Guarantees: **existence is still proven by the 200, never by the body.** The
 * body is read only to add what it happens to say, through shape checks that
 * fall back to `undefined`, so a non-conforming response reports an existing
 * index with an unknown configuration rather than becoming an error or, worse,
 * an index this package would try to create a second time.
 */
export async function describeIndex(
  ctx: IndexContext,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<IndexDescription> {
  checkAborted(operation, signal, ctx);
  try {
    const response = await ctx.client.send(
      new GetIndexCommand({
        vectorBucketName: ctx.vectorBucketName,
        indexName: ctx.indexName,
      }),
      sendOptions(signal),
    );
    const keys = nonFilterableMetadataKeysOf(response);
    const shape = indexShapeOf(response);
    return {
      exists: true,
      ...(keys === undefined ? {} : { nonFilterableMetadataKeys: keys }),
      ...shape,
    };
  } catch (error: unknown) {
    if (isAwsNotFoundException(error)) return { exists: false };
    throw wrapAwsError(error, classifyAwsError(error), 'GetIndex', {
      operation,
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  }
}

/**
 * Check the index's own distance metric against the one this store assumes.
 *
 * Accepts: the description `GetIndex` returned, the metric the store is
 * configured for, and the scope.
 *
 * Returns: nothing.
 *
 * Throws: `INDEX_CONFIG_MISMATCH` when the index disagrees.
 *
 * Guarantees, and why this is here rather than left to AWS:
 * - The metric is **already in the response** this package asks for on the
 *   first write. It was read for the metadata keys and the rest discarded, so
 *   the check costs no extra request.
 * - It cannot be changed after creation (userguide `s3-vectors-indexes.html`:
 *   "you can't update the vector index name, dimension, distance metric, or
 *   non-filterable metadata keys"), so a mismatch is permanent, not transient.
 * - Every other metric check lives on the read path, against a `QueryVectors`
 *   response, so a **write-only workload never caught the mismatch at all** —
 *   and the cosine-only zero-vector rule in `limits.ts` is applied from the
 *   *store's* configured metric, which on a mismatch is not the index's. A
 *   store configured `cosine` against a euclidean index refused vectors AWS
 *   would have taken; configured `euclidean` against a cosine index it sent a
 *   zero vector and got back the very `ValidationException` that rule exists to
 *   pre-empt.
 *
 * The **dimension** is deliberately not checked here, although the same
 * response carries it. AWS enforces it on every write and says so clearly, the
 * vectors' dimension is only known after the embedding has been paid for
 * anyway, and not pre-validating it is a standing decision of this package
 * (`store-index-lifecycle.test.ts`) taken when an index-configuration cache
 * went stale against an index re-created out of band. This check is narrower
 * than that cache was: one fresh response, read once, for the one field whose
 * mismatch silently changes what this package itself does.
 *
 * A metric the response did not state is not checked, for the same reason
 * {@link assertMetadataKeysAgree} skips an unreadable key list.
 */
function assertIndexMetricAgrees(
  description: IndexDescription,
  configuredMetric: DistanceMetric,
  ctx: IndexContext,
  operation: string,
): void {
  if (description.distanceMetric === undefined || description.distanceMetric === configuredMetric) {
    return;
  }
  throw new S3VectorsError(
    `Index "${ctx.indexName}" uses distance metric "${description.distanceMetric}", but this ` +
      `store is configured for "${configuredMetric}". An index's metric is fixed when it is ` +
      'created, so this cannot be corrected on the index: configure the store for the ' +
      "index's metric, or write to an index created with this store's.",
    S3VectorsErrorCode.INDEX_CONFIG_MISMATCH,
    {
      operation,
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    },
  );
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

function assertMetadataKeysAgree(
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
   * - `operation` — the public method this caller invoked, named in any error
   *   it receives.
   *
   * Returns: nothing. Existence is the entire result.
   *
   * Throws: `ABORTED` for `signal`; `INDEX_CONFIG_MISMATCH` when an existing
   * index's non-filterable keys disagree with this store's; `VALIDATION` for a
   * dimension, key set or tag set an index cannot be created with, before
   * `CreateIndex`; otherwise the class `classifyAwsError` assigns the failed
   * `GetIndex` or `CreateIndex`, carrying that command as `awsCommand`. A
   * `ConflictException` from `CreateIndex` is not an error — it means another
   * process created the index first, which is the requested state
   * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html).
   *
   * Guarantees: on resolution the index existed at some point during this
   * call. Concurrent callers share one request sequence, and so one failure —
   * but each receives it naming its own `operation`, with the same class,
   * cause, stack and `awsCommand`. Existence is remembered only on resolution,
   * never on failure.
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
   * - `operation` — the public method the caller invoked, named in any error.
   *
   * Returns: nothing.
   *
   * Throws: `ABORTED` for `signal`; otherwise the class `classifyAwsError`
   * assigns the failed `DeleteIndex`, carrying it as `awsCommand` — never the
   * failure of a creation it waited on, which is that write's to report —
   * except a response reporting the index absent, which resolves —
   * the requested state already holds. AWS returns a 404 `NotFoundException`
   * for an index that is already gone (docs/evidence/delete-absent.md), so
   * resolving is this package's decision, not the service's. The same 404 is
   * what a missing *bucket* produces, so it is followed by `GetVectorBucket`
   * (see `bucketPresence`): a bucket that is not there is `NOT_FOUND`, and an
   * `ABORTED` that cancelled that question carries it as `awsCommand`.
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
 * Throws: nothing. The 10-key ceiling and each key's own length are enforced
 * on this exact result — by the {@link AmazonS3Vectors} constructor at
 * construction, and again, as defence, by {@link assertMetadataKeysCreatable} at
 * index creation, where the error can name the index being created.
 */
export function resolveNonFilterableMetadataKeys(config: IndexLifecycleConfig): string[] {
  const configured = config.nonFilterableMetadataKeys ?? [];
  return config.pageContentMetadataKey === null
    ? [...configured]
    : [...new Set([...configured, config.pageContentMetadataKey])];
}

/**
 * The non-filterable keys a new index may be created with.
 *
 * The {@link AmazonS3Vectors} constructor already refuses a keys list this
 * rejects, for every store — including one that only ever reads. This is the
 * re-check kept at `CreateIndex` as defence, the way {@link assertTagsCreatable}
 * keeps its own, for anything that reaches here a second way.
 *
 * Returns: nothing, when every key is within bounds.
 *
 * @throws {S3VectorsError} `VALIDATION` for more than 10 keys, or a key
 * outside 1–63 characters (limits page). Checked before `CreateIndex` so the
 * failure names the configuration rather than arriving as an opaque rejection.
 */
export function assertMetadataKeysCreatable(
  keys: readonly string[],
  fail: (message: string) => never,
): void {
  if (keys.length > MAX_NON_FILTERABLE_KEYS) {
    fail(
      `An index may have at most ${MAX_NON_FILTERABLE_KEYS} non-filterable metadata keys; this configuration needs ${keys.length}.`,
    );
  }
  for (const key of keys) {
    if (key.length < METADATA_KEY_MIN_LENGTH || key.length > METADATA_KEY_MAX_LENGTH) {
      fail(
        `Non-filterable metadata key ${JSON.stringify(key)} must be ${METADATA_KEY_MIN_LENGTH}-${METADATA_KEY_MAX_LENGTH} characters.`,
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
    if (!isTagKeyLength(key)) {
      fail(
        `Tag key ${JSON.stringify(key)} must be ${TAG_KEY_MIN_LENGTH}-${TAG_KEY_MAX_LENGTH} characters.`,
      );
    }
    if (!isTagValueLength(value)) {
      fail(
        `Tag value for ${JSON.stringify(key)} must be ${TAG_VALUE_MIN_LENGTH}-${TAG_VALUE_MAX_LENGTH} characters.`,
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
  operation: string,
): void {
  const fail = (message: string): never => {
    throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, {
      operation,
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  };

  if (!Number.isInteger(dimension) || dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) {
    fail(
      `dimension must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION} (received ${renderValue(dimension)}).`,
    );
  }
  assertMetadataKeysCreatable(keys, fail);
  assertTagsCreatable(tags, fail);
}

/**
 * Create the index at `dimension`, from this store's configuration.
 *
 * Accepts: the index to create, the configuration to create it from, and the
 * public method it is created for, named in any error. No signal,
 * deliberately: the only caller is the shared memo, so no single caller may
 * cancel it out from under the others.
 *
 * Returns: `'created'` when this call created the index, and `'raced'` when
 * another writer created it first — a `ConflictException` means the requested
 * state was reached, not that anything failed
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html).
 * The caller re-reads the index in that second case, because the index is then
 * the winner's rather than this configuration's.
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
  operation: string,
): Promise<'created' | 'raced'> {
  const keys = resolveNonFilterableMetadataKeys(config);
  assertCreatable(ctx, dimension, keys, config.tags, operation);
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
    if (isAwsConflictException(error)) return 'raced';
    throw wrapAwsError(error, classifyAwsError(error), 'CreateIndex', {
      operation,
      vectorBucketName: ctx.vectorBucketName,
      indexName: ctx.indexName,
    });
  }
  return 'created';
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
 *   parallel writes issue one `GetIndex` and at most one `CreateIndex`. They
 *   share its failure too, and each still receives it under its own
 *   `operation`.
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
  // What an error names. Never `ctx` itself, which also holds the client.
  const scope: StoreScope = { vectorBucketName: ctx.vectorBucketName, indexName: ctx.indexName };

  return {
    async ensureExists(
      dimension: number,
      signal: AbortSignal | undefined,
      operation: string,
    ): Promise<void> {
      checkAborted(operation, signal, scope);
      if (knownToExist) return;

      memo ??= (async () => {
        try {
          const description = await describeIndex(ctx, undefined, operation);
          if (description.exists) {
            // Only for an index this store did not create. One it creates is
            // configured from this very list, so it agrees by construction.
            assertMetadataKeysAgree(
              description.nonFilterableMetadataKeys,
              resolveNonFilterableMetadataKeys(config),
              ctx,
              operation,
            );
            assertIndexMetricAgrees(description, config.distanceMetric, ctx, operation);
          } else if ((await createIndex(ctx, config, dimension, operation)) === 'raced') {
            // Another writer created it first, so the index has *their*
            // configuration, not this one's. Reading it back is what keeps this
            // store from budgeting metadata against a key set the index does
            // not have — for the rest of its life, since existence is then
            // remembered and no later write asks again. Live, the winner's
            // configuration is readable straight after the conflict
            // (docs/evidence/index-create-race.md).
            const winner = await describeIndex(ctx, undefined, operation);
            assertMetadataKeysAgree(
              winner.nonFilterableMetadataKeys,
              resolveNonFilterableMetadataKeys(config),
              ctx,
              operation,
            );
            assertIndexMetricAgrees(winner, config.distanceMetric, ctx, operation);
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
      try {
        await raceAbort(() => shared, signal, operation, scope);
      } catch (error: unknown) {
        // The memo's failure names whichever method started it. Every other
        // method waiting on it reports the same failure as its own.
        throw attachOperation(error, operation, scope);
      }
    },

    markAbsent(): void {
      knownToExist = false;
    },

    async deleteIndex(signal: AbortSignal | undefined, operation: string): Promise<void> {
      checkAborted(operation, signal, scope);

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
        await raceAbort(() => settled, signal, operation, scope);
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
        const failure = wrapAwsError(error, classifyAwsError(error), 'DeleteIndex', {
          operation,
          vectorBucketName: ctx.vectorBucketName,
          indexName: ctx.indexName,
        });
        if (!isAwsNotFoundException(error)) throw failure;

        // A 404: nothing of this name exists, whichever of the two is missing,
        // so the next write has to look again either way.
        knownToExist = false;
        if ((await bucketPresence(ctx, signal, operation)) === 'absent') {
          throw rebuildWithContext(
            failure,
            `${failure.message} The vector bucket "${ctx.vectorBucketName}" does not exist ` +
              '(GetVectorBucket answered 404 as well), so this is not an index that was already ' +
              'gone: nothing was deleted, and an index of this name may still exist in the ' +
              'bucket you meant. Check `vectorBucketName` and the region.',
            failure.context,
          );
        }
      }
      knownToExist = false;
    },
  };
}

/**
 * Whether the vector bucket is there — asked only once `DeleteIndex` has
 * answered 404, to learn which of the two things it named is missing.
 *
 * Accepts: the client and bucket, the caller's signal, and the public method to
 * name in an abort.
 *
 * Returns: `'present'` when `GetVectorBucket` resolves — proven by the 200,
 * never by the body; `'absent'` when it fails `NotFoundException`
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectorBucket.html);
 * `'unknown'` for any other failure — a denied request above all, since asking
 * needs `s3vectors:GetVectorBucket`, which deleting an index does not.
 *
 * Throws: `ABORTED`, carrying `awsCommand: "GetVectorBucket"`, when the signal
 * cancelled the request. A cancellation is the caller's, and is never read as
 * "could not tell".
 *
 * Guarantees, and why it exists. AWS answers a missing index and a missing
 * bucket with the same `NotFoundException` — "the specified resource can't be
 * found" (`API_S3VectorBuckets_DeleteIndex.html`) — and the exception carries
 * nothing but a message, which this package never branches on. `deleteIndex`
 * resolves on that 404, which is right for the first cause and was wrong for
 * the second: a store pointed at a mistyped bucket reported a production index
 * destroyed, and the index lived on. Every other operation already fails
 * against a bucket that is not there; this one alone swallowed it.
 *
 * It costs nothing on the path where the index was there to delete, and one
 * request on the path where it was not. And only a definite `'absent'` changes
 * the outcome: the check is a courtesy on top of a documented idempotent
 * success, so a caller granted `s3vectors:DeleteIndex` alone — who cannot ask —
 * still gets that success when they retry a delete that had already landed.
 * Failing them because a diagnostic was denied would turn a working
 * least-privilege setup into a failing one.
 */
async function bucketPresence(
  ctx: IndexContext,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<'present' | 'absent' | 'unknown'> {
  try {
    await ctx.client.send(
      new GetVectorBucketCommand({ vectorBucketName: ctx.vectorBucketName }),
      sendOptions(signal),
    );
    return 'present';
  } catch (error: unknown) {
    if (isAwsNotFoundException(error)) return 'absent';
    const code = classifyAwsError(error);
    if (code === S3VectorsErrorCode.ABORTED) {
      throw wrapAwsError(error, code, 'GetVectorBucket', {
        operation,
        vectorBucketName: ctx.vectorBucketName,
        indexName: ctx.indexName,
      });
    }
    return 'unknown';
  }
}
