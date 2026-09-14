[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / AmazonS3VectorsRetriever

# Class: AmazonS3VectorsRetriever\<V\>

Defined in: retriever.ts:67

The retriever [AmazonS3Vectors.asRetriever](AmazonS3Vectors.md#asretriever) returns.

## Remarks

Two signals, two jobs, each documented for exactly what it does:

| Source | Reaches | Effect |
|---|---|---|
| `asRetriever({ signal })` — a retriever **field** | `QueryVectors`, `GetVectors` | cancels the AWS request itself |
| `invoke(query, { signal })` — the runnable **config** | nothing downstream | the invocation rejects; the request in flight completes |

The asymmetry is core's, not this package's:
`BaseRetriever.invoke(input, options)` parses the config and then calls
`this._getRelevantDocuments(input, runManager)` (`@langchain/core@1.2.9`
`dist/retrievers/index.js:81` and `:85`) — the config never reaches the
extension point, so no subclass can read `config.signal` there. What this
class can do, it does: an already-fired config signal rejects before any
embedding or request, and one that fires mid-query rejects the invocation
instead of resolving with results.

Both may be supplied at once; they are independent.

## Extends

- `VectorStoreRetriever`\<`V`\>

## Type Parameters

### V

`V` *extends* [`AmazonS3Vectors`](AmazonS3Vectors.md) = [`AmazonS3Vectors`](AmazonS3Vectors.md)

## Constructors

### Constructor

> **new AmazonS3VectorsRetriever**\<`V`\>(`fields`): `AmazonS3VectorsRetriever`\<`V`\>

Defined in: retriever.ts:77

#### Parameters

##### fields

[`AmazonS3VectorsRetrieverInput`](../type-aliases/AmazonS3VectorsRetrieverInput.md)\<`V`\>

#### Returns

`AmazonS3VectorsRetriever`\<`V`\>

#### Overrides

`VectorStoreRetriever<V>.constructor`

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: retriever.ts:75

The field signal: threaded into every AWS request this retriever makes.

## Methods

### \_getRelevantDocuments()

> **\_getRelevantDocuments**(`query`, `runManager?`): `Promise`\<`DocumentInterface`\<`Record`\<`string`, `unknown`\>\>[]\>

Defined in: retriever.ts:122

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

`Promise`\<`DocumentInterface`\<`Record`\<`string`, `unknown`\>\>[]\>

The retrieved documents

#### Overrides

`VectorStoreRetriever._getRelevantDocuments`

***

### invoke()

> **invoke**(`input`, `options?`): `Promise`\<`DocumentInterface`\<`Record`\<`string`, `unknown`\>\>[]\>

Defined in: retriever.ts:102

Run the retriever, honouring a config signal as far as core allows.

#### Parameters

##### input

`string`

The query text

##### options?

`RunnableConfig`\<`Record`\<`string`, `any`\>\>

Core's runnable config. `options.signal` ends **this
invocation**: already fired, nothing is embedded or requested; fired
mid-query, the invocation rejects `ABORTED` while the request in flight
completes. To cancel the request itself, pass `signal` to
[AmazonS3Vectors.asRetriever](AmazonS3Vectors.md#asretriever) instead.

#### Returns

`Promise`\<`DocumentInterface`\<`Record`\<`string`, `unknown`\>\>[]\>

The retrieved documents

#### Throws

`ABORTED` when the config signal fires;
otherwise whatever the underlying search raises.

#### Overrides

`VectorStoreRetriever.invoke`

***

### lc\_name()

> `static` **lc\_name**(): `string`

Defined in: retriever.ts:70

#### Returns

`string`

#### Overrides

`VectorStoreRetriever.lc_name`
