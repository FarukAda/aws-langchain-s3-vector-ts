import type { CallbackManagerForRetrieverRun, Callbacks } from '@langchain/core/callbacks/manager';
import type { DocumentInterface } from '@langchain/core/documents';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  VectorStoreRetriever,
  type VectorStoreRetrieverInput,
  type VectorStoreRetrieverMMRSearchKwargs,
} from '@langchain/core/vectorstores';

import { raceAbort, type StoreScope } from './internal/signals.js';
import type { AmazonS3Vectors } from './s3-vectors.js';
import { attachOperation } from './shared/errors/decorate.js';

/**
 * Fields {@link AmazonS3Vectors.asRetriever} accepts: everything
 * `@langchain/core` documents, plus `signal`.
 */
export interface AmazonS3VectorsRetrieverFields<V extends AmazonS3Vectors = AmazonS3Vectors> {
  /** Documents to retrieve per query. @defaultValue `4` */
  readonly k?: number;
  /** Metadata filter applied to every search this retriever runs. */
  readonly filter?: V['FilterType'];
  /** `'similarity'` (default) or `'mmr'`. @defaultValue `'similarity'` */
  readonly searchType?: 'similarity' | 'mmr';
  /** `fetchK` and `lambda`, honoured only when `searchType` is `'mmr'`. */
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
  /** Run tags. This store's type is appended to whatever is given, as core does. */
  readonly tags?: string[];
  /** Run metadata, passed through to core's callback machinery unchanged. */
  readonly metadata?: Record<string, unknown>;
  /** Core's verbose flag, passed through unchanged. */
  readonly verbose?: boolean;
  /** Core's callbacks, passed through unchanged. Unlike the search methods, a signal here is not rejected — this is a field, not the callbacks *slot*. */
  readonly callbacks?: Callbacks;
}

/** What {@link AmazonS3VectorsRetriever}'s constructor takes. */
export type AmazonS3VectorsRetrieverInput<V extends AmazonS3Vectors = AmazonS3Vectors> =
  VectorStoreRetrieverInput<V> & { signal?: AbortSignal };

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
 *
 * The asymmetry is core's, not this package's:
 * `BaseRetriever.invoke(input, options)` parses the config and then calls
 * `this._getRelevantDocuments(input, runManager)` (`@langchain/core@1.2.11`
 * `dist/retrievers/index.js:81` and `:85`) — the config never reaches the
 * extension point, so no subclass can read `config.signal` there. What this
 * class can do, it does: an already-fired config signal rejects before any
 * embedding or request, and one that fires mid-query rejects the invocation
 * instead of resolving with results.
 *
 * Both may be supplied at once; they are independent.
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
   * @param fields - Everything core's `VectorStoreRetriever` takes, plus
   * `signal` — the field signal, threaded into every AWS request this
   * retriever makes
   * @returns The retriever. Constructing one issues no request.
   * @throws Nothing. `k`, `filter` and `searchKwargs` are validated when a
   * search runs, by the same guards a direct call goes through.
   */
  constructor(fields: AmazonS3VectorsRetrieverInput<V>) {
    super(fields);
    this.signal = fields.signal;
  }

  /** The bucket and index this retriever's errors name. */
  get #scope(): StoreScope {
    return {
      vectorBucketName: this.vectorStore.vectorBucketName,
      indexName: this.vectorStore.indexName,
    };
  }

  /**
   * Run the retriever, honouring a config signal as far as core allows.
   *
   * @param input - The query text
   * @param options - Core's runnable config. `options.signal` ends **this
   * invocation**: already fired, nothing is embedded or requested; fired
   * mid-query, the invocation rejects `ABORTED` while the request in flight
   * completes. To cancel the request itself, pass `signal` to
   * {@link AmazonS3Vectors.asRetriever} instead.
   * @returns The retrieved documents
   * @throws {S3VectorsError} Every error names `retriever.invoke` as its
   * operation. `ABORTED` when the config signal fires; otherwise whatever the
   * underlying search raises, with its code, cause, `awsCommand` and stack
   * unchanged. A failure core raises on the way that is not one of this
   * package's errors — a callback handler with `raiseError` set that throws, or
   * a non-positive `timeout` — is `UNEXPECTED_ERROR`, with it as the cause.
   * `batch` and `stream` run through this method, so they report the same.
   */
  override async invoke(
    input: string,
    options?: RunnableConfig,
  ): Promise<DocumentInterface<Record<string, unknown>>[]> {
    try {
      return await raceAbort(
        async () => await super.invoke(input, options),
        options?.signal,
        'retriever.invoke',
        this.#scope,
      );
    } catch (error: unknown) {
      throw attachOperation(error, 'retriever.invoke', this.#scope);
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
   * `ABORTED` for a fired field signal, `VALIDATION` for a bad `k`, `filter`
   * or `searchKwargs`, or the class an AWS failure maps to — which
   * {@link invoke}, the method callers reach this through, reports as its own.
   */
  override async _getRelevantDocuments(
    query: string,
    runManager?: CallbackManagerForRetrieverRun,
  ): Promise<DocumentInterface<Record<string, unknown>>[]> {
    const child = runManager?.getChild('vectorstore');
    if (this.searchType === 'mmr') {
      return await this.vectorStore.maxMarginalRelevanceSearch(
        query,
        {
          k: this.k,
          // Omitted rather than passed as `undefined`: core types `filter` as
          // optional but not `undefined`-valued, so handing it one is a type
          // error under `exactOptionalPropertyTypes` — and "no filter" is what
          // absence already means.
          ...(this.filter === undefined ? {} : { filter: this.filter }),
          ...this.searchKwargs,
        },
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
 * @returns A configured {@link AmazonS3VectorsRetriever}
 * @throws Nothing. Every argument it reads is validated when a search runs.
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
  const fields: AmazonS3VectorsRetrieverFields<V> =
    typeof kOrFields === 'number' || kOrFields === undefined ? {} : kOrFields;
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
  };

  return fields.searchType === 'mmr'
    ? new AmazonS3VectorsRetriever<V>({
        ...common,
        searchType: 'mmr',
        ...(fields.searchKwargs === undefined ? {} : { searchKwargs: fields.searchKwargs }),
      })
    : new AmazonS3VectorsRetriever<V>({ ...common, searchType: 'similarity' });
}
