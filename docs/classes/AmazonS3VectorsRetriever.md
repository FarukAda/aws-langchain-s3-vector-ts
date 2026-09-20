[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetriever

# Class: AmazonS3VectorsRetriever\<V\>

Defined in: [retriever.ts:205](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L205)

The retriever [AmazonS3Vectors.asRetriever](AmazonS3Vectors.md#asretriever) returns.

## Remarks

Two signals, two jobs, each documented for exactly what it does:

| Source | Reaches | Effect |
|---|---|---|
| `asRetriever({ signal })` — a retriever **field** | `QueryVectors`, `GetVectors` | cancels the AWS request itself |
| `invoke(query, { signal })` — the runnable **config** | nothing downstream | the invocation rejects; the request in flight completes |
| `invoke(query, { timeout })` — the runnable **config** | nothing downstream | the same, once the timeout passes |

The asymmetry is core's, not this package's:
`BaseRetriever.invoke(input, options)` parses the config and then calls
`this._getRelevantDocuments(input, runManager)` (`@langchain/core@1.2.11`
`dist/retrievers/index.js:81` and `:85`) — the config never reaches the
extension point, so no subclass can read `config.signal` there. What this
class can do, it does: an already-fired config signal rejects before any
embedding or request, and one that fires mid-query — or a timeout that
passes — rejects the invocation instead of resolving with results.

Both may be supplied at once; they are independent.

Its search fields — `k`, `filter`, `searchType`, `searchKwargs` and the
field `signal` — are checked when it is constructed, by the checks the
search they configure applies, so an invocation never fails on how the
retriever was built.

## Extends

- `VectorStoreRetriever`\<`V`\>

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](AmazonS3Vectors.md) = [`AmazonS3Vectors`](AmazonS3Vectors.md)

## Constructors

### Constructor

> **new AmazonS3VectorsRetriever**\<`V`\>(`fields`): `AmazonS3VectorsRetriever`\<`V`\>

Defined in: [retriever.ts:242](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L242)

#### Parameters

##### fields

[`AmazonS3VectorsRetrieverInput`](../type-aliases/AmazonS3VectorsRetrieverInput.md)\<`V`\>

Everything core's `VectorStoreRetriever` takes, plus
`signal` — the field signal, threaded into every AWS request this
retriever makes, and `scoreThreshold`

#### Returns

`AmazonS3VectorsRetriever`\<`V`\>

The retriever. Constructing one issues no request.

#### Throws

`VALIDATION`, naming `retriever.constructor` as
its operation. First, naming no bucket or index, for `fields` that are not
an object or whose `vectorStore` is not one. Then, naming the store's, for
a field no search this retriever runs could accept: a `searchType` other
than `'similarity'` or `'mmr'`; then, by the checks the search that type
dispatches to applies itself, for `'mmr'` a `searchKwargs` that is not an
object (`null` means none), `k`, `fetchK` and `lambda`, and for either
`filter`; then a `signal` that is not an `AbortSignal`. A signal that has
already fired is not refused here: it is `ABORTED` when the retriever runs.

#### Overrides

`VectorStoreRetriever<V>.constructor`

## Properties

### scoreThreshold?

> `readonly` `optional` **scoreThreshold?**: `number`

Defined in: [retriever.ts:225](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L225)

The relevance score a document must reach to be returned, or `undefined`
for every result the search found.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [retriever.ts:219](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L219)

The field signal: threaded into every AWS request this retriever makes.

Explicitly `| undefined`, not merely optional: a retriever built without one
assigns `undefined` here, which `exactOptionalPropertyTypes` distinguishes
from the property being absent.

## Methods

### \_getRelevantDocuments()

> **\_getRelevantDocuments**(`query`, `runManager?`): `Promise`\<`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [retriever.ts:421](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L421)

Core's extension point, overridden only to thread the field signal.

#### Parameters

##### query

`string`

The query text

##### runManager?

`CallbackManagerForRetrieverRun`

Core's callback manager for this run, forwarded to the
store's `Callbacks` slot exactly as core's own retriever forwards it

#### Returns

`Promise`\<`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]\>

The retrieved documents, at most `k` of them

#### Throws

Whatever the dispatched search raises —
`ABORTED` for a fired field signal, `VALIDATION` for a query that is not a
string or an unusable query embedding, or the class an AWS failure maps to
— which [invoke](#invoke), the method callers reach this through, reports as
its own. Called directly rather than through `invoke`, its errors name the
search it dispatches to (`similaritySearch` or
`maxMarginalRelevanceSearch`).

#### Overrides

`VectorStoreRetriever._getRelevantDocuments`

***

### addDocuments()

> **addDocuments**(`documents`, `options?`): `Promise`\<`string`[]\>

Defined in: [retriever.ts:395](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L395)

Add documents to the store this retriever reads from.

#### Parameters

##### documents

`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]

The documents to embed and store

##### options?

[`S3VectorsAddOptions`](../interfaces/S3VectorsAddOptions.md)

What [AmazonS3Vectors.addDocuments](AmazonS3Vectors.md#adddocuments) takes: `ids`,
`batchSize` and `signal`

#### Returns

`Promise`\<`string`[]\>

The ids assigned to each stored vector

#### Throws

Every error names `retriever.addDocuments` as its
operation; otherwise whatever [AmazonS3Vectors.addDocuments](AmazonS3Vectors.md#adddocuments) raises,
with its code, cause, context and stack unchanged.

#### Overrides

`VectorStoreRetriever.addDocuments`

***

### invoke()

> **invoke**(`input`, `options?`): `Promise`\<`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]\>

Defined in: [retriever.ts:359](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L359)

Run the retriever, honouring a config signal and timeout as far as core
allows.

#### Parameters

##### input

`string`

The query text

##### options?

`RunnableConfig`\<`Record`\<`string`, `any`\>\>

Core's runnable config. `options.signal` ends **this
invocation**: already fired, nothing is embedded or requested; fired
mid-query, the invocation rejects `ABORTED` while the request in flight
completes. `options.timeout`, when present, must be a whole number of
milliseconds from 1 to 2,147,483,647 — the longest delay Node's timers
honour — and ends the invocation the same way once that many milliseconds
have passed. To cancel the request itself, pass `signal` to
[AmazonS3Vectors.asRetriever](AmazonS3Vectors.md#asretriever) instead.

#### Returns

`Promise`\<`DocumentInterface`\<`Record`\<`string`, `any`\>\>[]\>

The retrieved documents

#### Throws

Every error names `retriever.invoke` as its
operation. Before anything is embedded or requested, in this order:
`VALIDATION` for a query that is not a string, a `timeout` outside that
range (`null` included), or a config `signal` that is not an `AbortSignal`;
`ABORTED` for a config signal that has already fired. Then `ABORTED` when
the config signal fires or the timeout passes mid-query, with the signal's
reason — a `TimeoutError` for the timeout — as the cause; otherwise
whatever the underlying search raises, with its code, cause, `awsCommand`
and stack unchanged. A callback handler with `raiseError` set that throws
is `UNEXPECTED_ERROR`, with its error as the cause. The retriever's own
fields were checked when it was built.

Core's `batch` and `stream` call this method, so a failure raised inside it
reaches them as described, and `batch` hands it each input's signal and
timeout. Two things never reach it: both refuse a non-positive `timeout`
with core's own uncoded `Error` before calling it, and `stream` races its
signal and timeout itself, rejecting with the signal's reason rather than
`ABORTED`.

#### Overrides

`VectorStoreRetriever.invoke`

***

### lc\_name()

> `static` **lc\_name**(): `string`

Defined in: [retriever.ts:208](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/retriever.ts#L208)

#### Returns

`string`

#### Overrides

`VectorStoreRetriever.lc_name`
