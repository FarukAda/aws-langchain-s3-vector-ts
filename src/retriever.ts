/**
 * Hides which search a retriever runs.
 *
 * A retriever is built once with its search type, `k`, filter, threshold and
 * signal, and then invoked with only a query. Turning that fixed configuration
 * into the right call — similarity, MMR, or a threshold read against relevance
 * rather than distance — happens here. Fields are validated when the retriever
 * is built, not when it runs, so a misconfiguration surfaces at the point the
 * mistake was made.
 */
import {
  parseCallbackConfigArg,
  type CallbackManagerForRetrieverRun,
  type Callbacks,
} from '@langchain/core/callbacks/manager';
import type { DocumentInterface } from '@langchain/core/documents';
import { ensureConfig, type RunnableConfig } from '@langchain/core/runnables';
import {
  VectorStoreRetriever,
  type MaxMarginalRelevanceSearchOptions,
  type VectorStoreRetrieverInput,
  type VectorStoreRetrieverMMRSearchKwargs,
} from '@langchain/core/vectorstores';

import { resolveMmrParameters } from './actions/mmr.js';
import { parseFilter } from './internal/filter.js';
import { parseK, assertOptionsBag, assertQueryText, validationError } from './internal/guards.js';
import { parseSignal, raceAbort } from './internal/signals.js';
import type { AmazonS3Vectors } from './s3-vectors.js';
import { renderValue } from './shared/describe.js';
import { attachOperation } from './shared/errors/decorate.js';
import { S3VectorsErrorCode } from './shared/errors/error-code.js';
import { S3VectorsError } from './shared/errors/s3-vectors-error.js';
import { isObjectLike } from './shared/objects.js';
import type { StoreScope } from './shared/scope.js';
import type { S3VectorsAddOptions } from './types.js';

/**
 * The longest `timeout` that works: Node's timers run a longer delay after
 * 1 ms instead (Node.js `timers` documentation, `setTimeout`), and
 * `AbortSignal.timeout`, which core builds a timeout's signal with, does the
 * same with a `TimeoutOverflowWarning`.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Refuse a runnable config `timeout` that could not work, before core reads it.
 *
 * Accepts: `undefined` (no timeout), or a whole number of milliseconds from 1
 * to {@link MAX_TIMEOUT_MS}.
 *
 * Throws: `VALIDATION`, naming what arrived.
 *
 * Guarantees: at least as strict as core, which refuses a `timeout` of 0 or
 * less, `null` included (`@langchain/core` `runnables/config`,
 * `ensureConfig`), so no timeout core would refuse reaches it. What core
 * accepts beyond that and cannot use is refused too: `AbortSignal.timeout`
 * throws a raw `RangeError` for a fraction, `NaN`, `Infinity` or a delay past
 * 4294967295, and a raw `TypeError` for a string, and runs anything past
 * {@link MAX_TIMEOUT_MS} as 1 ms.
 */
function assertTimeout(operation: string, scope: StoreScope, timeout: unknown): void {
  if (timeout === undefined) return;
  if (
    typeof timeout !== 'number' ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw validationError(
      operation,
      scope,
      `timeout must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS} ` +
        `(received ${renderValue(timeout)}).`,
    );
  }
}

/**
 * The constructor's fields, refused before core reads them.
 *
 * Core's constructor reads `fields.vectorStore`, and this class reads that
 * store's bucket and index, so fields that are not an object, or hold no store
 * object, would otherwise escape as a raw `TypeError`. No store is known, so
 * the error names none.
 */
function requireRetrieverInput<T>(fields: T): T {
  const fail: (detail: string) => never = (detail) => {
    throw new S3VectorsError(
      `AmazonS3VectorsRetriever cannot be built: ${detail}`,
      S3VectorsErrorCode.VALIDATION,
      { operation: 'retriever.constructor' },
    );
  };
  if (!isObjectLike(fields)) {
    fail(`the fields must be an object (received ${renderValue(fields)}).`);
  }
  if (!isObjectLike(fields.vectorStore)) {
    fail(
      'fields.vectorStore must be the store to read from ' +
        `(received ${renderValue(fields.vectorStore)}).`,
    );
  }
  return fields;
}

/**
 * Fields {@link AmazonS3Vectors.asRetriever} accepts: everything
 * `@langchain/core` documents, plus `signal` and `scoreThreshold`.
 *
 * Distinct from {@link AmazonS3VectorsRetrieverInput}, which is what the
 * retriever's **constructor** takes and which additionally carries core's
 * `vectorStore` — `asRetriever` already has the store.
 */
export interface AmazonS3VectorsRetrieverFields<V extends AmazonS3Vectors = AmazonS3Vectors> {
  /** Documents to retrieve per query, 1–10,000. @defaultValue `4` */
  readonly k?: number;
  /** Metadata filter applied to every search this retriever runs. */
  readonly filter?: V['FilterType'];
  /** `'similarity'` (default) or `'mmr'`; anything else is refused. @defaultValue `'similarity'` */
  readonly searchType?: 'similarity' | 'mmr';
  /** `fetchK` and `lambda`, honoured — and checked — only when `searchType` is `'mmr'`; `null` means none. */
  readonly searchKwargs?: VectorStoreRetrieverMMRSearchKwargs;
  /**
   * Cancels the AWS requests this retriever makes — genuinely, because a
   * retriever field needs no per-invocation state and so can be threaded into
   * `QueryVectors` and `GetVectors`. Distinct from the signal on
   * `invoke(query, { signal })`, which core never routes to a retriever's
   * extension point and which therefore ends the invocation without cancelling
   * the request already in flight.
   */
  readonly signal?: AbortSignal;
  /**
   * Keep only documents whose **relevance score** is at least this — the score
   * {@link AmazonS3Vectors.similaritySearchWithRelevanceScores} computes, where
   * higher is better, not the raw distance. At most `k` documents are fetched
   * and then filtered, so a threshold never widens the search.
   *
   * Only for `searchType: 'similarity'`; MMR returns documents without scores,
   * and asking for both is refused. On a euclidean index it needs
   * `relevanceScoreFn`, and is refused without one when the retriever is built.
   *
   * `@langchain/classic`'s `ScoreThresholdRetriever` is **not** an alternative
   * here: it thresholds `similaritySearchWithScore`, which this store answers
   * with AWS's distance, where lower is better — so it keeps the worst matches
   * and drops the best.
   */
  readonly scoreThreshold?: number;
  /** Run tags. This store's type is appended to whatever is given, as core does. */
  readonly tags?: string[];
  /** Run metadata, passed through to core's callback machinery unchanged. */
  readonly metadata?: Record<string, unknown>;
  /** Core's verbose flag, passed through unchanged. */
  readonly verbose?: boolean;
  /** Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*. */
  readonly callbacks?: Callbacks;
}

/**
 * What {@link AmazonS3VectorsRetriever}'s **constructor** takes — core's own
 * `VectorStoreRetrieverInput` plus the two fields this package adds.
 *
 * Distinct from {@link AmazonS3VectorsRetrieverFields}, which is what
 * {@link AmazonS3Vectors.asRetriever} takes. The two overlap but are not the
 * same: this one carries core's `vectorStore`, because a constructor is handed
 * the store it reads from, and `asRetriever` already knows it.
 *
 * The two added fields are `readonly` to match every other published option
 * type here; core's own fields are as core declares them.
 */
export type AmazonS3VectorsRetrieverInput<V extends AmazonS3Vectors = AmazonS3Vectors> =
  VectorStoreRetrieverInput<V> & {
    readonly signal?: AbortSignal;
    readonly scoreThreshold?: number;
  };

/**
 * The retriever {@link AmazonS3Vectors.asRetriever} returns.
 *
 * @remarks
 * Two signals, two jobs, each documented for exactly what it does:
 *
 * | Source | Reaches | Effect |
 * |---|---|---|
 * | `asRetriever({ signal })` — a retriever **field** | `QueryVectors`, `GetVectors` | cancels the AWS request itself |
 * | `invoke(query, { signal })` — the runnable **config** | nothing downstream | the invocation rejects; the request in flight completes |
 * | `invoke(query, { timeout })` — the runnable **config** | nothing downstream | the same, once the timeout passes |
 *
 * The asymmetry is core's, not this package's:
 * `BaseRetriever.invoke(input, options)` parses the config and then calls
 * `this._getRelevantDocuments(input, runManager)` (`@langchain/core@1.2.11`
 * `dist/retrievers/index.js:81` and `:85`) — the config never reaches the
 * extension point, so no subclass can read `config.signal` there. What this
 * class can do, it does: an already-fired config signal rejects before any
 * embedding or request, and one that fires mid-query — or a timeout that
 * passes — rejects the invocation instead of resolving with results.
 *
 * Both may be supplied at once; they are independent.
 *
 * Its search fields — `k`, `filter`, `searchType`, `searchKwargs` and the
 * field `signal` — are checked when it is constructed, by the checks the
 * search they configure applies, so an invocation never fails on how the
 * retriever was built.
 */
export class AmazonS3VectorsRetriever<
  V extends AmazonS3Vectors = AmazonS3Vectors,
> extends VectorStoreRetriever<V> {
  static override lc_name(): string {
    return 'AmazonS3VectorsRetriever';
  }

  /**
   * The field signal: threaded into every AWS request this retriever makes.
   *
   * Explicitly `| undefined`, not merely optional: a retriever built without one
   * assigns `undefined` here, which `exactOptionalPropertyTypes` distinguishes
   * from the property being absent.
   */
  readonly signal?: AbortSignal | undefined;

  /**
   * The relevance score a document must reach to be returned, or `undefined`
   * for every result the search found.
   */
  readonly scoreThreshold?: number | undefined;

  /**
   * @param fields - Everything core's `VectorStoreRetriever` takes, plus
   * `signal` — the field signal, threaded into every AWS request this
   * retriever makes, and `scoreThreshold`
   * @returns The retriever. Constructing one issues no request.
   * @throws {S3VectorsError} `VALIDATION`, naming `retriever.constructor` as
   * its operation. First, naming no bucket or index, for `fields` that are not
   * an object or whose `vectorStore` is not one. Then, naming the store's, for
   * a field no search this retriever runs could accept: a `searchType` other
   * than `'similarity'` or `'mmr'`; then, by the checks the search that type
   * dispatches to applies itself, for `'mmr'` a `searchKwargs` that is not an
   * object (`null` means none), `k`, `fetchK` and `lambda`, and for either
   * `filter`; then a `signal` that is not an `AbortSignal`. A signal that has
   * already fired is not refused here: it is `ABORTED` when the retriever runs.
   */
  constructor(fields: AmazonS3VectorsRetrieverInput<V>) {
    super(requireRetrieverInput(fields));
    this.signal = fields.signal;
    this.scoreThreshold = fields.scoreThreshold;
    this.#assertSearchFields('retriever.constructor');
  }

  /** The bucket and index this retriever's errors name. */
  get #scope(): StoreScope {
    return {
      vectorBucketName: this.vectorStore.vectorBucketName,
      indexName: this.vectorStore.indexName,
    };
  }

  /**
   * The options an MMR search receives — built in one place, so what the
   * constructor checks is exactly what {@link _getRelevantDocuments} sends.
   */
  get #mmrOptions(): MaxMarginalRelevanceSearchOptions<V['FilterType']> {
    return {
      k: this.k,
      // Omitted rather than passed as `undefined`: core types `filter` as
      // optional but not `undefined`-valued, so handing it one is a type error
      // under `exactOptionalPropertyTypes` — and "no filter" is what absence
      // already means.
      ...(this.filter === undefined ? {} : { filter: this.filter }),
      ...this.searchKwargs,
    };
  }

  /**
   * Refuse a field no search this retriever runs could accept, by the checks
   * that search applies and in the order it applies them — so an invocation
   * never fails on how the retriever was built, and in particular never
   * reports a fired invocation signal over a field that could not have worked.
   */
  #assertSearchFields(operation: string): void {
    const scope = this.#scope;
    // Widened, because the declared type is what an untyped caller can break.
    const searchType: unknown = this.searchType;
    if (searchType === 'mmr') {
      if (this.scoreThreshold !== undefined) {
        throw validationError(
          operation,
          scope,
          "scoreThreshold cannot be combined with searchType 'mmr': a maximal-marginal-relevance " +
            'search returns documents without scores, so there is nothing to threshold. Use ' +
            "searchType 'similarity' with a threshold, or MMR without one.",
        );
      }
      assertOptionsBag(operation, scope, this.searchKwargs, '`searchKwargs`');
      const options = this.#mmrOptions;
      resolveMmrParameters(options, operation, scope);
      parseFilter(options.filter, operation, scope);
    } else if (searchType === 'similarity') {
      parseK(operation, scope, this.k);
      parseFilter(this.filter, operation, scope);
      if (this.scoreThreshold !== undefined) {
        if (typeof this.scoreThreshold !== 'number' || !Number.isFinite(this.scoreThreshold)) {
          throw validationError(
            operation,
            scope,
            `scoreThreshold must be a finite number (received ${renderValue(this.scoreThreshold)}). ` +
              'It is compared against the relevance score, where higher is better.',
          );
        }
        // A euclidean index has no built-in conversion, so there would be
        // nothing to compare against; refused here rather than at the first
        // invocation, as every other field is.
        this.vectorStore._assertRelevanceScoresAvailable();
      }
    } else {
      const received =
        typeof searchType === 'string' ? JSON.stringify(searchType) : renderValue(searchType);
      throw validationError(
        operation,
        scope,
        `searchType must be 'similarity' or 'mmr' (received ${received}).`,
      );
    }
    parseSignal(operation, this.signal, scope);
  }

  /**
   * Run the retriever, honouring a config signal and timeout as far as core
   * allows.
   *
   * @param input - The query text
   * @param options - Core's runnable config. `options.signal` ends **this
   * invocation**: already fired, nothing is embedded or requested; fired
   * mid-query, the invocation rejects `ABORTED` while the request in flight
   * completes. `options.timeout`, when present, must be a whole number of
   * milliseconds from 1 to 2,147,483,647 — the longest delay Node's timers
   * honour — and ends the invocation the same way once that many milliseconds
   * have passed. To cancel the request itself, pass `signal` to
   * {@link AmazonS3Vectors.asRetriever} instead.
   * @returns The retrieved documents
   * @throws {S3VectorsError} Every error names `retriever.invoke` as its
   * operation. Before anything is embedded or requested, in this order:
   * `VALIDATION` for a query that is not a string, a `timeout` outside that
   * range (`null` included), or a config `signal` that is not an `AbortSignal`;
   * `ABORTED` for a config signal that has already fired. Then `ABORTED` when
   * the config signal fires or the timeout passes mid-query, with the signal's
   * reason — a `TimeoutError` for the timeout — as the cause; otherwise
   * whatever the underlying search raises, with its code, cause, `awsCommand`
   * and stack unchanged. A callback handler with `raiseError` set that throws
   * is `UNEXPECTED_ERROR`, with its error as the cause. The retriever's own
   * fields were checked when it was built.
   *
   * Core's `batch` and `stream` call this method, so a failure raised inside it
   * reaches them as described, and `batch` hands it each input's signal and
   * timeout. Two things never reach it: both refuse a non-positive `timeout`
   * with core's own uncoded `Error` before calling it, and `stream` races its
   * signal and timeout itself, rejecting with the signal's reason rather than
   * `ABORTED`.
   */
  override async invoke(input: string, options?: RunnableConfig): Promise<DocumentInterface[]> {
    try {
      assertQueryText('retriever.invoke', this.#scope, input);
      assertTimeout('retriever.invoke', this.#scope, options?.timeout);
      // Before core reads the config: combining a signal with a timeout's goes
      // through `AbortSignal.any`, which throws a raw `TypeError` for a value
      // that is not a signal.
      parseSignal('retriever.invoke', options?.signal, this.#scope);
      // Core's own first step (`@langchain/core@1.2.11`
      // `dist/retrievers/index.js:82`), taken here because it is what turns a
      // positive `timeout` into a signal (`dist/runnables/config.js:105-126`),
      // which core's `invoke` never races. The config it returns has no
      // `timeout` left, so core's second pass starts no second timer.
      const config: RunnableConfig = ensureConfig(parseCallbackConfigArg(options));
      return await raceAbort(
        async () => await super.invoke(input, config),
        config.signal,
        'retriever.invoke',
        this.#scope,
      );
    } catch (error: unknown) {
      throw attachOperation(error, 'retriever.invoke', this.#scope);
    }
  }

  /**
   * Add documents to the store this retriever reads from.
   *
   * @param documents - The documents to embed and store
   * @param options - What {@link AmazonS3Vectors.addDocuments} takes: `ids`,
   * `batchSize` and `signal`
   * @returns The ids assigned to each stored vector
   * @throws {S3VectorsError} Every error names `retriever.addDocuments` as its
   * operation; otherwise whatever {@link AmazonS3Vectors.addDocuments} raises,
   * with its code, cause, context and stack unchanged.
   */
  override async addDocuments(
    documents: DocumentInterface[],
    options?: S3VectorsAddOptions,
  ): Promise<string[]> {
    try {
      return await this.vectorStore.addDocuments(documents, options);
    } catch (error: unknown) {
      throw attachOperation(error, 'retriever.addDocuments', this.#scope);
    }
  }

  /**
   * Core's extension point, overridden only to thread the field signal.
   *
   * @param query - The query text
   * @param runManager - Core's callback manager for this run, forwarded to the
   * store's `Callbacks` slot exactly as core's own retriever forwards it
   * @returns The retrieved documents, at most `k` of them
   * @throws {S3VectorsError} Whatever the dispatched search raises —
   * `ABORTED` for a fired field signal, `VALIDATION` for a query that is not a
   * string or an unusable query embedding, or the class an AWS failure maps to
   * — which {@link invoke}, the method callers reach this through, reports as
   * its own. Called directly rather than through `invoke`, its errors name the
   * search it dispatches to (`similaritySearch` or
   * `maxMarginalRelevanceSearch`).
   */
  override async _getRelevantDocuments(
    query: string,
    runManager?: CallbackManagerForRetrieverRun,
  ): Promise<DocumentInterface[]> {
    const child = runManager?.getChild('vectorstore');
    if (this.scoreThreshold !== undefined) {
      // The relevance score, not the distance: higher is better, and the
      // conversion is the one `similaritySearchWithRelevanceScores` applies.
      const scored = await this.vectorStore.similaritySearchWithRelevanceScores(
        query,
        this.k,
        this.filter,
        child,
        this.signal,
      );
      const threshold = this.scoreThreshold;
      return scored.filter(([, score]) => score >= threshold).map(([document]) => document);
    }
    if (this.searchType === 'mmr') {
      return await this.vectorStore.maxMarginalRelevanceSearch(
        query,
        this.#mmrOptions,
        child,
        this.signal,
      );
    }
    return await this.vectorStore.similaritySearch(query, this.k, this.filter, child, this.signal);
  }
}

/**
 * Build the retriever from the two shapes core's `asRetriever` accepts.
 *
 * @param store - The store the retriever reads from
 * @param kOrFields - `k` as a number, or the fields object
 * @param filter - Positional filter, used only with the numeric form
 * @param callbacks - Positional callbacks, used only with the numeric form
 * @param tags - Positional tags, used only with the numeric form
 * @param metadata - Positional metadata, used only with the numeric form
 * @param verbose - Positional verbose flag, used only with the numeric form
 * @returns A configured {@link AmazonS3VectorsRetriever}. A `kOrFields` of
 * `undefined` or `null` means no fields, as for every options bag.
 * @throws {S3VectorsError} Every error names `asRetriever`, the method the
 * caller invoked: `VALIDATION` for a `kOrFields` that is neither a number nor
 * an object, by the options-bag check every method applies; whatever the
 * retriever's constructor refuses; and `UNEXPECTED_ERROR` for anything else
 * that throws while it is built, such as a `tags` that is not a list. A
 * `searchType` reaches the constructor as given, so one it does not recognise
 * is refused rather than read as `'similarity'`.
 */
export function createRetriever<V extends AmazonS3Vectors>(
  store: V,
  kOrFields?: number | AmazonS3VectorsRetrieverFields<V>,
  filter?: V['FilterType'],
  callbacks?: Callbacks,
  tags?: string[],
  metadata?: Record<string, unknown>,
  verbose?: boolean,
): AmazonS3VectorsRetriever<V> {
  const scope: StoreScope = {
    vectorBucketName: store.vectorBucketName,
    indexName: store.indexName,
  };
  try {
    // A number is `k`; anything else is the fields bag, read as every options
    // bag is read.
    if (typeof kOrFields !== 'number') {
      assertOptionsBag(
        'asRetriever',
        scope,
        kOrFields,
        'The argument, when it is not a number `k`,',
      );
    }
    return buildRetriever(store, kOrFields, filter, callbacks, tags, metadata, verbose);
  } catch (error: unknown) {
    throw attachOperation(error, 'asRetriever', scope);
  }
}

/** {@link createRetriever} without the renaming: the two argument shapes, already checked, resolved into one retriever. */
function buildRetriever<V extends AmazonS3Vectors>(
  store: V,
  kOrFields: number | AmazonS3VectorsRetrieverFields<V> | null | undefined,
  filter: V['FilterType'] | undefined,
  callbacks: Callbacks | undefined,
  tags: string[] | undefined,
  metadata: Record<string, unknown> | undefined,
  verbose: boolean | undefined,
): AmazonS3VectorsRetriever<V> {
  const fields: AmazonS3VectorsRetrieverFields<V> =
    typeof kOrFields === 'number' ? {} : (kOrFields ?? {});
  // Resolved first, so the object below reads as one rule per option rather than
  // a ternary per line.
  const k = typeof kOrFields === 'number' ? kOrFields : fields.k;
  const resolvedFilter: V['FilterType'] | undefined = fields.filter ?? filter;
  const resolvedCallbacks = fields.callbacks ?? callbacks;
  const resolvedMetadata = fields.metadata ?? metadata;
  const resolvedVerbose = fields.verbose ?? verbose;

  const common = {
    vectorStore: store,
    // The store type is appended rather than replacing the caller's tags,
    // matching core (`@langchain/core@1.2.11` `dist/vectorstores.js`
    // `asRetriever`), so tracing keeps identifying the backend.
    tags: [...(fields.tags ?? tags ?? []), store._vectorstoreType()],
    // Each option is omitted rather than set to `undefined`. Core declares them
    // optional but not `undefined`-valued, so handing one an explicit undefined
    // is a type error under `exactOptionalPropertyTypes` — and absence is what
    // passing undefined was trying to say anyway.
    ...(k === undefined ? {} : { k }),
    ...(resolvedFilter === undefined ? {} : { filter: resolvedFilter }),
    ...(resolvedCallbacks === undefined ? {} : { callbacks: resolvedCallbacks }),
    ...(resolvedMetadata === undefined ? {} : { metadata: resolvedMetadata }),
    ...(resolvedVerbose === undefined ? {} : { verbose: resolvedVerbose }),
    ...(fields.signal === undefined ? {} : { signal: fields.signal }),
    ...(fields.scoreThreshold === undefined ? {} : { scoreThreshold: fields.scoreThreshold }),
  };

  return fields.searchType === 'mmr'
    ? new AmazonS3VectorsRetriever<V>({
        ...common,
        searchType: 'mmr',
        ...(fields.searchKwargs === undefined ? {} : { searchKwargs: fields.searchKwargs }),
      })
    : new AmazonS3VectorsRetriever<V>({
        ...common,
        ...(fields.searchType === undefined ? {} : { searchType: fields.searchType }),
      });
}
