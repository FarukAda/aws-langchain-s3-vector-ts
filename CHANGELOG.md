# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`asRetriever({ scoreThreshold })`.** Keeps only documents whose relevance
  score — higher is better, the same conversion
  `similaritySearchWithRelevanceScores` applies — reaches the threshold. It is
  checked when the retriever is built, like every other field: combined with
  `searchType: 'mmr'` it is refused, because MMR returns documents without
  scores, and on a euclidean index with no `relevanceScoreFn` it is refused
  rather than failing at the first query. This exists because the obvious
  LangChain route is wrong against this store: `@langchain/classic`'s
  `ScoreThresholdRetriever` filters on `similaritySearchWithScore`, which here
  is AWS's raw distance, where lower is better — so it keeps the worst matches
  and drops the best. `similaritySearchWithScore` still returns the distance;
  what changed is that a threshold is now available that reads the right number.

- **A misspelled configuration option is refused, not ignored.** `new
  AmazonS3Vectors(embeddings, { …, createIndexIfNotExists: false })` — one
  letter out — constructed a store that created the index with every default,
  and an index's configuration cannot be changed afterwards. A key that differs
  from an option only in case, or that is within two edits of one or the start
  of one, now raises `VALIDATION` naming both. Unrecognised keys that are not
  near misses are still accepted, because `@langchain/core`'s
  `SemanticSimilarityExampleSelector` passes its own `k`, `filter`,
  `exampleKeys` and `inputKeys` in the same object; the closest any of those
  comes to an option here is four edits.

- **`writeRateLimit`: writes are paced to AWS's per-index limits.** S3 Vectors
  allows up to 1,000 `PutVectors`/`DeleteVectors` requests and 2,500 vectors a
  second per index, and nothing here bounded either: `maxConcurrentBatchCalls`
  caps one call's requests in flight, so eight concurrent writes on one store
  had eighty. Measured against the live service, eight concurrent `addVectors`
  of 25,000 vectors ran at 18,078 vectors/s, drew 120
  `TooManyRequestsException`s and failed **every** call with 63,800 of 200,000
  vectors written. Every store now paces its writes and deletes against one
  shared budget in those two units, defaulting to AWS's own numbers; the same
  load then wrote all 200,000 vectors with no failures and no throttling at
  all. Two alternatives were measured on that load and neither worked: a
  store-wide cap of ten requests in flight still ran at 6,937 vectors/s and
  failed every call, and the SDK's `adaptive` retry mode fell to 774 vectors/s
  and still failed every call — a concurrency cap does not bound a rate
  (`docs/evidence/write-rate.md`). Set `writeRateLimit` to raise the rates if
  you have measured your own headroom, or to `false` to pace nothing.

- **`flattenMetadata`, for documents a loader or splitter produced.** S3 Vectors
  stores no nested object, no `null`, no empty array and no mixed array — under
  a non-filterable key just as much as a filterable one, measured against the
  live service (`docs/evidence/metadata-value-types.md`). Every chunk
  `@langchain/textsplitters` returns carries `loc: { lines: { from, to } }`, and
  the PDF loaders in `@langchain/community` add `pdf: { … }` and `loc: { … }`,
  so the standard ingestion pipeline was refused on its first write. This
  exported helper turns those into the dotted keys the service does store
  (`loc.lines.from`), drops the fields a loader leaves empty, and passes
  everything else through untouched so a value it cannot flatten is still
  refused by name at the write rather than silently converted. It refuses a
  collision (`'loc.pageNumber'` alongside `loc: { pageNumber }`) instead of
  picking one. It is a function you call, not a store option: what a store
  writes stays what you passed it.

- **Write batches are split to fit AWS's request limit.** S3 Vectors refuses a
  request body over 20 MiB — exactly and inclusively: 20,971,520 bytes is
  accepted and one byte more comes back `ValidationException` "Request body
  exceeds max allowed size" (`docs/evidence/request-payload-limit.md`). The
  default batch of 200 records at 4,096 dimensions carrying 39 KB of page
  content is 23.9 MiB, and AWS's own guidance to write "batches up to the
  maximum batch size of 500 vectors" reaches it sooner still. `addVectors` and
  `addDocuments` now split such a batch across as many `PutVectors` requests as
  it needs, before sending anything, so `batchSize` is the ceiling on records
  per request rather than a promise of one request. Nothing changes for a batch
  that already fits, which is every batch that was not being refused. A failure
  partway through a split batch reports the ids its earlier requests wrote, as
  a failure between batches always has.

- **`error.context.recordIndex` and `error.context.recordId`.** A refusal about
  one element of a list — a document, its metadata, a vector, a text or a
  `metadatas` entry passed to fromTexts, or an id — now says which one: its
  position in *your* input, counted over the whole call rather than within a
  batch, and its id when it has one. The message leads with the same, as
  `Document at index 400 (id "ticket-400"): …`. Both fields are optional and
  appear only on errors about a single element of a list.

- **`error.context.awsCommand`: the AWS request that failed.** The S3 Vectors
  API operation — `GetIndex`, `CreateIndex`, `DeleteIndex`, `PutVectors`,
  `DeleteVectors`, `QueryVectors`, `GetVectors` or `ListVectors` — set on every
  error that wraps a failed AWS request, an `ABORTED` that cancelled one in
  flight included, and absent from every other: a validation error, an abort
  that cancelled no request, a failure of caller-supplied code, and an
  `AWS_INVALID_RESPONSE` about a response that did arrive. Reads never reported
  the request at all, and writes, deletes and `deleteIndex` reported it in
  place of the method (see *Changed*). The message names both, as
  `addDocuments failed on PutVectors (AccessDeniedException, HTTP 403, requestId …): …`.

### Changed

- **`context.operation` is the public method the caller invoked on every
  error, a failed AWS request included.** Five paths named the AWS command
  instead: a refused
  `GetIndex`, `CreateIndex` or `PutVectors` reported `operation: "GetIndex"`,
  `"CreateIndex"` or `"PutVectors"` from `addVectors` and `addDocuments`, a
  refused `DeleteVectors` reported `"DeleteVectors"` from `delete`, and a
  refused `DeleteIndex` reported `"DeleteIndex"` from `deleteIndex` — while
  every read (`getByIds`, the searches, MMR, the listings) named the method, so
  one call's failures were split across two names depending on which request
  failed. They report the method now, with the command in `awsCommand`; a
  creation rule refused at the index step, which named `createIndex` — neither
  a method nor a command — names the write too. **Migration:** a branch on
  `context.operation === 'PutVectors'` becomes
  `context.awsCommand === 'PutVectors'`, and likewise for `GetIndex`,
  `CreateIndex`, `DeleteVectors` and `DeleteIndex`; a branch on the method
  (`operation === 'addDocuments'`) now also sees that method's request
  failures.

  The retriever and the static factories reported the method they ran
  underneath instead. A retriever's failures named `similaritySearch` or
  `maxMarginalRelevanceSearch` — only its own `invoke` signal firing named
  `retriever.invoke` — its inherited `addDocuments` named `addDocuments`, and
  `fromDocuments`/`fromTexts` named `constructor` for a configuration the store
  refused and `addDocuments` for a failed write. Each now names itself —
  `retriever.invoke`, `retriever.addDocuments`, `fromDocuments`, `fromTexts` —
  with the code, cause, `awsCommand`, stack and `context.instance` unchanged. A
  failure raised inside `retriever.invoke` reaches core's `batch` and `stream`
  under that name too; what those two refuse before calling `invoke` does not
  (see *Fixed*). **Migration:** match `retriever.invoke`,
  `retriever.addDocuments`, `fromDocuments` or `fromTexts` where a branch
  expected the underlying method's name from those calls.

- **`addVectors` requires every vector in the call to share one dimension, and
  checks it before writing anything.** It was checked per batch, so a call whose
  later batch disagreed wrote its earlier batches and then failed. An index has
  one dimension, so such a call could never succeed whole; it is now refused whole,
  with `INDEX_CONFIG_MISMATCH` naming the first vector that differs.

- **A filter holding `NaN`, `±Infinity` or a `Date` is refused.** S3 Vectors
  accepts what they become — the AWS SDK sends a non-finite number as the string
  `"NaN"` and a `Date` as a timestamp — and the filter then silently matches
  nothing, or compares against a number nobody wrote
  ([`docs/evidence/filter-validation.md`](./docs/evidence/filter-validation.md),
  T3-19). This is the rule metadata already followed, and it is the one place
  the filter check refuses something the service would take.

- **A timed-out, reset, refused or unreachable connection is
  `SERVICE_UNAVAILABLE`.** The SDK's HTTP handler raises `TimeoutError` for a
  connection, socket-idle or request timeout and for
  `ECONNRESET`/`EPIPE`/`ETIMEDOUT`, and its retry strategy treats that name as
  transient alongside `RequestTimeoutException` — which this package already
  mapped to `SERVICE_UNAVAILABLE`. That was `AWS_REQUEST_FAILED` before, so
  retry logic keyed on the documented transient codes treated a timeout as a
  hard failure; only `context.retryable` said otherwise. The same retry
  strategy also matches five more Node.js system error codes directly by
  `code`, without renaming the error, so the error keeps its own `name`:
  `ECONNREFUSED` (refused), `EHOSTUNREACH`/`ENETUNREACH` (unreachable) and
  `ENOTFOUND`/`EAI_AGAIN` (DNS failure). Those five are now
  `SERVICE_UNAVAILABLE` too, instead of `AWS_REQUEST_FAILED`, when they fail
  an AWS request — matched on the error's own `code`; the SDK also finds such
  a code in the error's `cause`, which this package does not. A caller
  branching on `AWS_REQUEST_FAILED` for a timeout, a reset, a refused or an
  unreachable connection must switch to `SERVICE_UNAVAILABLE`.

- **A `nonFilterableMetadataKeys` list no index could ever be created with is
  refused at construction, not on the first write.** Merged with
  `pageContentMetadataKey` (added unless it is `null`), more than 10 keys or a
  key outside 1–63 characters can never be written to any index. It was
  refused only once a write first created the index — after its `GetIndex`
  and, for `addDocuments`, after the first batch was embedded — so a store
  configured this way could sit unused, or serve reads, before the mistake
  surfaced. A store configured with such a list now fails to construct, even
  one that never writes, and the error's context names the bucket and index,
  as every constructor error raised after those two names are checked does.
  `CreateIndex` still re-checks the same rule, as defence.

- **One order of checks on every public entry point, when several faults
  coincide: every refusal the arguments alone decide (`VALIDATION`, and
  `addVectors`' `INDEX_CONFIG_MISMATCH` for vectors that disagree on
  dimension), then `ABORTED` for an already-fired signal, then an empty
  input's free `[]`, then anything spent (resolving the embeddings model,
  embedding, the AWS request).** Previously the order depended on the method. Observable
  differences: `addVectors` and `delete` now report `VALIDATION`, not
  `ABORTED`, for a malformed id alongside a fired signal, matching
  `addDocuments` and `getByIds`; `addVectors`, `addDocuments` and `getByIds`
  now refuse `batchSize: 0` even when the list they are given is empty,
  instead of resolving `[]`, as `delete` already did; `addDocuments` and `getByIds` now report
  `ABORTED` for a fired signal alongside a valid empty list, matching
  `addVectors` and `delete`; and `addDocuments` on a store with no
  embeddings model now resolves `[]` for `addDocuments([])` and reports
  `VALIDATION` for invalid input, rather than always failing
  `EMBEDDINGS_MISSING` first.

- **An invalid retriever configuration fails at `asRetriever()`, not at the
  first `invoke`.** A retriever's `k`, `filter`, `searchType`, `searchKwargs`
  (an object holding `fetchK` and `lambda`, for `'mmr'`) and field `signal` are
  checked when it is built — by the checks the search they configure applies,
  in that search's order — and refused with `VALIDATION` naming `asRetriever`,
  or `retriever.constructor` for a retriever constructed directly. They were
  checked only once a search ran, so an `invoke` handed an already-fired
  signal reported `ABORTED` for a retriever that could never have searched,
  against the order above; a `searchType` other than `'similarity'` or `'mmr'`
  ran as a similarity search; and a `searchKwargs` that was not an object was
  spread into the search's options as nothing. `asRetriever`'s argument is
  read as every options bag is: `null` means no fields, as `undefined` does,
  and one that is neither a number nor an object — a string, an array, `true`
  — is `VALIDATION`; `asRetriever(null)` threw a raw `TypeError`, and a string
  built a default retriever. `retriever.invoke` likewise checks its query, and
  then its `timeout` — a whole number of milliseconds from 1 to 2,147,483,647
  when present — before it looks at its signal. **Migration:** a `try` that
  caught a configuration `VALIDATION` from the first `invoke` must surround
  `asRetriever()` instead.

### Fixed

- **An encryption configuration AWS would refuse is refused at construction.**
  `CreateIndex` enforces the pairing in both directions — "kmsKeyArn must not be
  specified when sseType is AES256." (and an absent `sseType` reads as
  `AES256`), and "kmsKeyArn must be specified when sseType is set to aws:kms" —
  neither of which the API reference states. Both are now checked before any
  request, rather than arriving at the first write after its batch has been
  embedded (`docs/evidence/index-encryption.md`).

- **`delete()` sends through the store's own client, whatever its params
  carry.** The parameters were spread into the internal call, so an extra
  `client` key — from an application config object spread into the call, say —
  sent `DeleteVectors` through that client instead. Only `ids`, `batchSize` and
  `signal` are forwarded now, and the refusal of the legacy `deleteAll` flag is
  unchanged.

- **`fromTexts`/`fromDocuments` keep their write options off the store.** They
  take `ids`, `batchSize` and `signal` in the same object as the store
  configuration, and LangChain's `Serializable` keeps that object on the
  instance as `lc_kwargs` — so an id list passed to a factory stayed in memory
  for the store's lifetime and appeared in `util.inspect(store)`. The store is
  now built from the configuration alone.

- **A store that loses an index-creation race now reads what the winner
  created.** Two stores writing to the same new index race, and the loser got
  `ConflictException`, treated it as success and recorded the index as
  existing — so it never issued another `GetIndex`, and if the winner had a
  different `nonFilterableMetadataKeys` this store spent the rest of its life
  budgeting metadata against a set the index does not have, refusing writes AWS
  would take and sending writes AWS refuses. The README said the next write's
  `GetIndex` would surface that; no such request was ever made. The loser now
  re-reads the index and applies the same check it applies to any index it did
  not create, which costs one request on the race path only. Live, the winner's
  configuration is readable immediately (`docs/evidence/index-create-race.md`).

- **An empty metadata array, and one mixing strings with numbers, are refused
  locally.** S3 Vectors rejects both ("Empty arrays are not allowed in metadata";
  "Metadata array values must be strings or numbers" —
  [`docs/evidence/metadata-value-types.md`](./docs/evidence/metadata-value-types.md),
  T3-14). The local check examined each element on its own, so both shapes passed
  it and failed at AWS, taking every other document in the same `PutVectors` call
  down with them. They are `VALIDATION` now, naming the key.

- **A string containing an unpaired UTF-16 surrogate is refused locally,
  wherever it would be sent to AWS.** AWS fails the whole request carrying one
  with `SerializationException` and the message "UnknownError"
  ([`docs/evidence/string-encoding.md`](./docs/evidence/string-encoding.md),
  T3-15), which surfaced as an `AWS_REQUEST_FAILED` naming nothing. It is
  `VALIDATION` now, naming where the string was found and the position of the
  stray code unit. The boundaries: a metadata key or string, page content
  included — it is stored as metadata, and text cut mid-emoji is the usual
  source; a vector id, on `addVectors`, `addDocuments`, `delete` and `getByIds`;
  a filter's field name or string; and, at construction,
  `pageContentMetadataKey`, a `nonFilterableMetadataKeys` entry, a tag key or
  value, and `encryptionConfiguration.kmsKeyArn`, which made `CreateIndex` — or,
  for the page-content key, every write — fail.

- **The README said `NaN` passes the metadata type check.** It has been refused
  since the value-type rules landed; the section now says so, and why.

- **`getByIds` checks its ids before sending them.** An empty id, one over 1,024
  characters, or one that is not a string went to `GetVectors`, which refuses the
  whole batch: one bad id cost every valid id batched with it, and AWS's error
  named a position inside that batch (`'/keys/20'`) rather than in the caller's
  list. `getByIds` now refuses it locally with `VALIDATION`, naming its position,
  as `delete` already did. A repeated id is still accepted.

- **`delete` documented only half of its id rules.** Its `@throws` named a missing
  or non-array `ids`; the per-id rules and the refusal of a repeated id were
  enforced but unstated.

- **`similaritySearchVectorWithScore` documented one of the codes it raises, and
  the *Errors* tables said every `VALIDATION` is raised before any AWS call.**
  The search's `@throws` named only `AWS_INVALID_RESPONSE`, and the text searches
  defer to it; it names every code now. Two `VALIDATION`s come later — a
  model's output, and response metadata that cannot be copied — and the
  tables say when each is raised.

- **A write refuses an input it cannot store before spending anything.** Metadata
  and vector checks ran inside each batch's write — after `addDocuments` had
  embedded that batch, and after every earlier batch had been stored. One bad
  record anywhere in a bulk ingest left the index partially written, and the
  embedding spend for every batch up to it was wasted, then paid again by the
  documented retry. Every check that depends only on the input now runs over the
  whole input before the first embedding call and the first request; a model's
  vectors are checked as each batch returns, before that batch is written. The
  batch write itself (`putBatch`) no longer validates at all, so each rule is
  stated once.

- **A `null` vector after the first no longer escapes as `UNEXPECTED_ERROR`.**
  Only the first vector of a batch was checked for being an array; a later one
  was read with `.length` and raised a `TypeError`. Every vector is now checked,
  and a non-array is `VALIDATION` naming its position.

- **An embeddings model that returns a non-array, or a list holding one, is
  `VALIDATION`.** Both escaped as a raw `TypeError` wrapped in
  `UNEXPECTED_ERROR`; the wrong number of vectors was already `VALIDATION`.

- **A vector refusal names the vector's position in the caller's input.** It named
  its position inside a batch, which is wrong for every vector after the first
  batch — the report's `NaN` in vector #450 was reported as "index 50".

- **MMR holds its query vector to the rules similarity search does.**
  `similaritySearch` refused an empty, non-finite or zero-norm query vector
  locally; `maxMarginalRelevanceSearch`, and so every `searchType: 'mmr'`
  retriever, sent it to AWS and surfaced the bare "Query vector contains invalid
  values or is invalid for this index" after a billable round trip. Both paths
  now refuse it the same way, before any request.

- **A text query that is not a string is refused before it is embedded.** Every
  text search passed whatever it was given to the embeddings model — an array
  from a repeated query-string parameter, `undefined` from a missing one — which
  either embedded it or failed inside the provider. It is `VALIDATION` now, on
  `similaritySearch`, `similaritySearchWithScore`,
  `similaritySearchWithRelevanceScores` and `maxMarginalRelevanceSearch`, before
  any billable call.

- **MMR's candidate query no longer asks for metadata it discards.** The
  documents it returns are built from the `GetVectors` response, so the metadata
  on the `QueryVectors` candidates was never read — at about four times the
  response size.

- **A filter condition with more than one key is refused locally.**
  `{ genre, year }` read like an implicit AND and passed the local check, but S3
  Vectors rejects any condition object with more than one key, at every level
  (T3-17), with its bare "Invalid filter". The refusal now shows the `$and` to
  write instead.

- **Filter operands are checked against the type each operator takes.** Only
  `$in`/`$nin` being non-empty was checked, so `$in: [null]`, `$exists: "yes"`,
  `$gt: "2020"` and `$eq: ["a"]` all reached AWS (T3-16). Each is `VALIDATION` now,
  naming the path, and the check enforces each operator's exact operand rule.

- **A field's operator object may hold only comparison operators.** An empty
  object, a key that is not an operator, and `$and`/`$or` under a field were
  passed through — two unit tests asserted they should be, pending evidence.
  The evidence says AWS rejects all three (T3-18), and so does this package now.

- **A missing query model names the search that needed it.** Every read path
  reported `context.operation: "query"`, so logs could not tell
  `similaritySearch` from `maxMarginalRelevanceSearch`; it names the public method
  now, as every other error does.

- **Decorating an error can no longer throw.** Rebuilding an error with extra
  context read `stack.indexOf` without checking `stack` was a string — reachable
  only through a value forging this package's error brand, but inside error
  handling, where a second failure replaces the first. Pagination errors built
  their own copy of that splice; they now share the one guarded implementation.

- **An `encryptionConfiguration.kmsKeyArn` that is not a string is refused at
  construction.** It was passed to `CreateIndex` unchecked.

- **The documentation counted the options a `client` excludes as five.** They are
  eight: the three timeouts were added to the rule and left out of the prose in
  four places, and the constructor's `@param` list — a partial copy of
  `AmazonS3VectorsConfig`'s own field documentation — had drifted the same way.
  The prose no longer counts, and the constructor refers to the type instead of
  copying it.

- **A metadata clone failure from a search named `createDocument` and no
  index.** `createDocument` defaulted its operation to its own name, so the
  `VALIDATION` it raises when a result's metadata cannot be structured-cloned —
  reachable only from a non-conforming client — reported
  `context.operation: "createDocument"` from `similaritySearchVectorWithScore`
  and everything built on it, instead of the method the caller invoked. Every
  path that builds a document this way — the searches, `getByIds`,
  `listDocuments` and `listVectors` — also carried no
  `vectorBucketName`/`indexName`. `createDocument` now takes the operation,
  bucket and index as a required parameter; every caller supplies its own.

- **Every failure out of `retriever.invoke` and the retriever's construction
  is an `S3VectorsError`.** A callback handler with `raiseError` set that
  threw escaped `invoke` raw; it is `UNEXPECTED_ERROR` now, with its error as
  `cause`. A `timeout` that could not work escaped raw too: `@langchain/core`
  refused one of 0 or less, `null` included, and Node's `AbortSignal.timeout`
  threw for a fraction, `NaN`, `Infinity`, a string or a delay past
  4,294,967,295 — and ran one past 2,147,483,647 as 1 ms. Each is `VALIDATION`
  now, before core reads it. `new AmazonS3VectorsRetriever(fields)` threw a
  raw `TypeError` for `fields` that are not an object or hold no `vectorStore`
  object; that is `VALIDATION` naming `retriever.constructor` and no store. A
  failure raised inside `invoke` reaches core's `batch` and `stream` coded
  too. Two failures of theirs never reach `invoke` and stay core's own: both
  refuse a `timeout` of 0 or less before calling it, and `stream` rejects with
  its signal's reason when its signal fires or its timeout passes.

- **A `timeout` ends `retriever.invoke`.** Core turns it into a
  signal and never races that signal, so `invoke(query, { timeout: 20 })` ran
  to completion however long it took. It now rejects `ABORTED`, naming
  `retriever.invoke`, with the `TimeoutError` as `cause` — as a config signal
  that fires does.

- **Two decorated errors lost the stack of the failure they decorated.** A
  failed `GetVectors` batch reported with `context.foundIds`, and a failed
  listing page reported with `pagesScanned`, `yielded` and the IAM hint, were
  built as new errors, so their stacks started at the decorator rather than
  where the request failure was wrapped. They are rebuilt the way every other
  decorated error is, and keep it.

- **An abort raised by the index tracker carried the SDK client.** The tracker
  handed its own context — the client included — to its abort checks, so an
  `ABORTED` from a write waiting on a shared index check, or from `deleteIndex`,
  had `context.client`, which `JSON.stringify(error.context)` and a structured
  logger render. An abort error names only the operation, bucket and index,
  whatever object the scope it is given is.

- **Concurrent writes waiting on one index check each name themselves.** The
  first write to an index shares its `GetIndex`/`CreateIndex` with every write
  started meanwhile, and a failure of that check was raised once and handed to
  all of them — so an `INDEX_CONFIG_MISMATCH` reached an `addDocuments` call
  as `operation: "addVectors"` when an `addVectors` call had started the check.
  Each write now receives the failure under its own method, with the same
  code, cause, `awsCommand` and stack.

### Internal

- **Every module states the decision it hides.** Thirty-five of the
  forty-six modules under `src/` opened straight into their imports. Each
  export carried a contract, which answers "what does this do?" for one
  function; none of them answered "why is this a module?" — which is the
  question that decides whether a change lands in one file or five. Each module
  now opens with that statement, and a contract test in
  `test/contract/source-contracts.test.ts` fails on a module that has none, or
  whose block is short enough to be a label rather than a decision. The
  orphaned-contract check learned about module docs at the same time, so it
  still refuses two adjacent contract blocks anywhere else.

- **One word per concept, where three words named two concepts.** `key` meant
  a vector's identifier in `internal/ids.ts` and `internal/get-vectors.ts`, a
  metadata field name in `internal/index-lifecycle.ts` and `shared/metadata.ts`,
  and an error-context property in `internal/concurrency.ts` — while the same
  vector identifier was called `id` in every error message, in the published
  surface (`getByIds`, `writtenIds`, `recordId`) and in half of the same files.
  A vector's identifier is now `id` everywhere between the caller and the
  command; `key` survives only where a request is built or a response read,
  which is where the service's own word belongs and where the translation is
  now visible. A metadata field name is `nonFilterableMetadataKeys` in all
  three places that previously spelled it three ways, and the property selector
  is `contextField`. Nothing published changed: `S3OutputVector.key` and
  `S3VectorsRecord.key` are the wire shape and keep AWS's word.

- **`assertIdsWellFormed` asked two questions and now asks one.** It checked
  both whether the service could store an id at all and whether one call
  repeated it — one name for two rules, which is why the name was hard to pick.
  Shape stays with `assertIdsWellFormed`; repetition is `assertIdsUnique`, and
  the two write paths call both. `getByIds` calls only the first, which is what
  it always meant: `GetVectors` accepts a repeated id.

- **The import direction between the layers of `src/` is a gate, not a
  convention.** `test/contract/layer-direction.test.ts` places every module in
  one of six layers — `leaf`, `shared`, `internal`, `actions`, `store`,
  `entry` — and fails on an import that reaches a later one. Four upward
  imports had already accumulated, every one of them `import type`, which
  erases at run time and so left no cycle, no failing test and nothing for a
  reviewer to notice; they were found by drawing the graph by hand. A module
  added to `src/` without a place in the table fails too, so nothing escapes
  the rule by being unlisted.

- **`StoreScope` and `OperationScope` moved to `shared/scope.ts`.** Three of
  those four imports were `shared/errors/decorate.ts`, `shared/metadata.ts` and
  `shared/validation.ts` reaching up into `internal/` for a plain data type.
  Both types carry no behaviour and no client, and the modules that name an
  index and an operation in every message they build are the ones lowest down,
  so the types belong there. The fourth is
  `shared/errors/s3-vectors-error.ts` naming `AmazonS3Vectors` for
  `S3VectorsErrorContext.instance`, which is published API — it is recorded in
  the test as the single permitted exception, with the reason and what removing
  it would cost.

## [1.0.0-rc.2] - 2026-09-16

A contract-first rework of the whole package. Every function was specified
before it was changed: the domain of each one enumerated as a table of
distinguishable input states with a decided answer for every cell, each answer
citing an AWS API reference, the `@aws-sdk/client-s3vectors` service model,
`@langchain/core`'s own source, or a recorded live probe — and one test per
cell, written from the contract rather than from the implementation. Nine
behaviours AWS does not document were settled against the live service and
recorded under [`docs/evidence/`](./docs/evidence/), each now guarded by a live
test so a change on AWS's side fails a run rather than going unnoticed. Three of
those reversed a decision that had been made on reasoning alone.

No change to what is stored: everything written before this reads back
identically, and the wire format is untouched.

### Breaking

- **`isAwsValidationException` is removed.** It had no caller in `src` — only a
  test — and `classify.ts` already maps `ValidationException` by name, so it was
  a second way to ask a question that already had one answer.

- **Every internal is a `#private` field or method.** TypeScript's `private` is
  erased, so `_client`, `_lifecycle`, `_queryEmbeddings`, `_nonFilterableKeys`,
  `_relevanceScoreFn` and the private methods were all ordinary runtime members:
  enumerable own properties or prototype entries, reachable by anyone who
  looked. README claimed the store "never keeps `credentials` or the SDK
  `client` in any enumerable field", which was not true of `_client`. It is now,
  by construction rather than by care.

- **`_selectRelevanceScoreFn` is gone from the runtime surface.** It carried
  `@internal` and `stripInternal`, so it was absent from the published `.d.ts`
  while remaining callable — and its own comment said `@langchain/core` calls it,
  which core does not: this package's own `similaritySearchWithRelevanceScores`
  does. It is `#private`, and typedoc no longer documents a method consumers
  cannot see in the types.

- **`error.code` and `error.context` are readonly at runtime,** which the class
  has always documented and did not enforce. Both were reassignable, and
  `context` was stored as the caller's own object, so whoever built an error
  could rewrite what it reported afterwards. The context is now a frozen copy,
  made from property descriptors so the deliberately non-enumerable
  `context.instance` survives it.

- **`exactOptionalPropertyTypes` and `noImplicitOverride` are on.** The README
  described this package as built under strict TypeScript; `tsconfig.json`
  explicitly disabled the first. Turning them on surfaced sixteen places handing
  an explicit `undefined` to a property typed as optional-but-not-undefined —
  every AWS `send` call's `abortSignal` among them — which is now a `sendOptions`
  helper that omits the property instead. Consumer-visible only in that the
  published types are stricter, and a consumer building under the same flag no
  longer has to work around them.

- **`delete` validates its ids the way a write does,** locally, before any
  request: a `null`, an empty string, a number, an over-long key or a repeated
  key is now refused rather than forwarded. All of them are refused by AWS too,
  probed against the live service — `Member must have length between 1 and 1024`
  for the empty string, and `Request must not contain duplicate keys` for the
  repeat — so forwarding them only ever bought a round trip to be told what this
  package already knew.

  Duplicates are worth calling out: this looked like the one rule a delete could
  safely relax, on the reasoning that deleting a key twice is idempotent. It is
  not. `DeleteVectors` refuses the whole request.

- **A query vector is validated the way a stored vector is.** Its components were
  never checked, so `[NaN, 1, 2]`, `['1','2','3']`, `[]` and the zero vector all
  went to AWS. Every one of them comes back as `Query vector contains invalid
  values or is invalid for this index` — a message naming neither the component
  nor the reason — so the round trip bought nothing this package could not say
  itself, and say better.

- **`fromTexts` checks the two arguments its types cannot police.** A `metadatas`
  that is neither an array nor an object was broadcast to every document and then
  spread into one metadata key per character; a `texts` entry that was not a
  string became a `Document` with a non-string `pageContent` and failed later as
  a raw `TypeError`. Both are refused by position now.

- **A document must have a string `pageContent` and an object `metadata`.** A
  number under `pageContent` was written as a number and read back as `''` with
  the original left behind in metadata; a string under `metadata` was spread into
  one key per character. Both wrote something, successfully, that nobody asked
  for.

- **A listing failure says how far it got.** The one failure the documentation
  singles out — a `listVectors` record arriving without data — was raised outside
  the generator that keeps the page and yield counters, so it was the only
  listing failure unable to report them. It is raised inside it now, and an
  empty `float32` is refused as well as a missing one: `[]` satisfied a check for
  `undefined`, so a record with no embedding was yielded as though it had one,
  and the migration case `listVectors` exists for would have written
  dimensionless vectors into the target index and looked complete.

- **`ResourceNotFoundException` is no longer read as an absent index.** Other AWS
  services use that name; S3 Vectors declares thirteen exceptions and it is not
  among them. The not-found predicate accepted it while `classify.ts` — whose
  table is exactly those thirteen — called the same value an ordinary request
  failure, so two modules disagreed about one value with nothing able to trigger
  it. If it ever does arrive, from a proxy or a middleware, that is not evidence
  an index is gone, and creating one on the strength of it is the wrong recovery.

- **`ThrottlingException`, `InternalServerError` and `RequestTimeout` are gone
  from the retryable set,** because S3 Vectors sends none of them. The real names
  are `TooManyRequestsException`, `InternalServerException` and
  `RequestTimeoutException`, and all three were already there. A new contract
  test reads the thirteen names out of the SDK and fails on any the code acts on
  that the service does not declare, so this cannot drift back.

- **`delete` no longer destroys the index; `deleteIndex()` does.** `ids` is now
  required, and `deleteAll` is refused with a message naming the replacement.
  `@langchain/core` describes the interface method as "remove stored documents
  by ID", S3 Vectors has no truncate operation, and a flag meaning "all of
  them" is how a production index gets destroyed by a typo. Destroying an index
  now has to be named to be called. `deleteIndex()` is idempotent and takes an
  optional `signal`, exactly as the flag did.

- **`getByIds` returns `(Document | undefined)[]`.** A missing id is now an
  `undefined` slot in the id's position rather than a thrown `NOT_FOUND`.
  `GetVectors` returns neither an entry nor an error for a key that is not
  stored ([`docs/evidence/get-vectors-absent-keys.md`](./docs/evidence/get-vectors-absent-keys.md)),
  so absence is an ordinary answer; keeping the slot means the result can never
  be silently misaligned against the id list. A batch that genuinely fails still
  throws, with `context.foundIds` listing what was already retrieved.
- **`addTexts` and `similaritySearchByVector` are removed.** Neither is part of
  `@langchain/core`'s `VectorStore`. `addTexts` duplicated the text-to-`Document`
  mapping `fromTexts` performs; `similaritySearchByVector` was
  `similaritySearchVectorWithScore` with the scores discarded. Use
  `addDocuments` (or `fromTexts`) and `similaritySearchVectorWithScore`.
- **`similaritySearchWithRelevanceScores` on a euclidean index with no
  `relevanceScoreFn` now raises `VALIDATION`.** The previous heuristic divided a
  squared distance by a linear scale and returned a number in a narrow band near
  1 — comparable against nothing. Euclidean distance is unbounded above, so no
  fixed conversion exists without knowing the embedding's scale. Supply
  `relevanceScoreFn`, or read raw distances with `similaritySearchWithScore`.
  `euclideanRelevanceScoreFn` is no longer exported.
- **Supplying `client` together with `region`, `credentials`, `endpoint`,
  `maxAttempts`, `retryMode`, `connectionTimeout`, `socketTimeout` or
  `requestTimeout` is rejected.** Each of those configures the client this store
  would otherwise build, and a supplied client carries its own — so they were
  silently ignored, leaving a caller who passed `maxAttempts: 5` with the
  client's retry policy and no indication. Pass one or the other.
- **`S3VectorsErrorCode.NOT_IMPLEMENTED` is removed** (MMR is implemented), and
  **`context.indexCacheInvalidated` is removed** (there is no index cache to
  invalidate). A `ValidationException` from AWS is now `AWS_REJECTED` rather
  than `AWS_REQUEST_FAILED`; see *Error classes* below.

- **A non-object options bag is refused by every method that takes one,** not
  read as an absent one. `assertOptionsBag` was written for exactly this and
  wired into `addVectors` alone, so the other seven — `addDocuments`,
  `getByIds`, `delete`, `deleteIndex`, `listDocuments`, `listVectors` and
  `maxMarginalRelevanceSearch` — took a string, a number or a stray array in
  the options position and read every option in it as unset. The cost is
  silence in each case: `deleteIndex('cancel-me')` destroyed the index with the
  caller's signal dropped, `addDocuments(docs, ids)` with the ids array in the
  bag's place wrote generated UUIDs nobody could reconcile afterwards, and
  `maxMarginalRelevanceSearch('q', 5)` — a plausible misreading of an API where
  `similaritySearch('q', 5)` is right — ran with `k` defaulted to `4` and
  returned four documents as though that had been asked for. `undefined` and
  `null` still mean "no options", unchanged.

  `listDocuments` and `listVectors` are now generators rather than methods that
  return one, so the refusal arrives on the first `next()` — the same place an
  out-of-range `pageSize` arrives, and inside any `try` wrapped around the loop.
  Found by re-running the audit's own probes against the finished package
  rather than against the tests written for each finding.

### Internal

- **Every AWS limit enforced from two places is stated once,** in
  `shared/aws-limits.ts`. `MAX_TOP_K` lived in two files, the dimension bounds in
  two, the metadata-key length under two different names, the tag bounds twice
  over. Every copy agreed — and nothing would have failed if one had been updated
  and the others left behind. A limit enforced in one place only stays with the
  code that enforces it.

- **The plain-object check is one module and two names.** Four functions were
  called `isPlainObject`, and they did not agree: two walked the prototype chain
  to reject `Date` and class instances, two accepted anything that was not an
  array. A call site said `isPlainObject` and meant whichever its own file
  defined. They are `isPlainObject` (strict, for data that will be stored) and
  `isObjectLike` (loose, for an options bag) now, so picking between them is a
  decision rather than an accident of which file you are in.

- Both are held in place by a new contract test rather than by care. `jscpd`
  reports zero clones on this package and always did: this duplication was
  single-line constants in different files under names that do not match, which
  is not a shape a clone detector can see.

### Fixed

- **MMR honours `maxConcurrentBatchCalls`.** Its `GetVectors` fan-out never
  received the store's cap and fell back to the helper's own default of 10, so a
  store configured for strictly sequential calls issued ten at once. A cap a
  caller sets to bound their request rate against a shared account quota is not
  advisory.

- **MMR validates `k`, `fetchK`, `lambda` and the filter before embedding the
  query.** They were validated first inside the search helper, which the store
  calls *after* `embedQuery` — so an impossible `k` cost a billable,
  uncancellable round trip before failing, which is the opposite of what the
  method's own documentation promised. A `lambda` that is not a number is now
  refused by a type check first, because `>=` and `<=` coerce and the comparison
  itself could throw before the value was ever reported.

- **`deleteIndex({ signal })` stops waiting for an in-flight index creation when
  the signal fires,** as it was documented to. It awaited the shared creation
  without racing the signal, so an abort did nothing until the creation finished
  and `DeleteIndex` was then issued anyway with an already-aborted signal. The
  creation itself is still not cancelled — it is shared, and not one caller's to
  end — but this caller's wait is their own.

- **No error message can throw while being built.** `String()` on an object
  with a null prototype raises "Cannot convert object to primitive value", so
  reporting a bad value could fail *while reporting it* — and the caller was
  handed `UNEXPECTED_ERROR` about the formatting failure instead of
  `VALIDATION` about their input. Fixed first for vector components, then for
  every remaining site that reads a caller's value into a message: MMR's
  bounds, `pageSize`, `batchSize`, `maxConcurrentBatchCalls`, the index
  dimension, and `toError`'s own fallback. `toError` is documented as throwing
  nothing and runs inside error handling, where a second failure replaces the
  first.

- **A write to an index that disagrees about non-filterable keys is refused
  with `INDEX_CONFIG_MISMATCH`.** `nonFilterableMetadataKeys` decides two
  different things — which keys a created index excludes from filters, and which
  keys the local 2 KB filterable-metadata budget leaves out — and only the first
  was ever checked against the index that was actually being written to.

  When they disagree the budget is computed against the wrong set, and it fails
  in both directions. Confirmed against the live service: the identical
  3,000-byte value was rejected on an index that did not declare its key
  non-filterable and accepted on one that did. So a store whose list ran longer
  than the index's sent writes AWS refuses, after the embedding was paid for.

  The index is now checked where this package already reads it, on the
  `GetIndex` that precedes a first write — the same way `distanceMetric` is
  checked against every first query page, and for the same reason. Existence is
  still proven by the response status alone, never by the body: a response this
  package cannot read reports an existing index with an unknown configuration
  rather than becoming an error.

  The default configuration makes the disagreement easy to hit without noticing,
  because the store adds `pageContentMetadataKey` to its own non-filterable set.
  Pointing a default store at an index created by the console or the CLI now
  fails immediately and says so, instead of silently spending the filterable
  budget on page content.

- **A store-built client now has timeouts.** The AWS SDK applies none by
  default, so an endpoint that accepted a connection and then never answered
  blocked `getByIds`, `addDocuments` and every search *forever* unless the
  caller passed an `AbortSignal` — and nothing said so. New `connectionTimeout`
  (5,000 ms) and `socketTimeout` (60,000 ms) options carry those defaults, and
  `0` disables either.

  `socketTimeout` is idle-based, which is why it is the one with a default: a
  large batch that is still transferring never trips it, while a request that
  has gone silent is ended. `requestTimeout` is also exposed but deliberately
  *not* defaulted, because it is a total deadline and would cut short a
  legitimately slow 500-vector upload; setting it also sets the SDK's
  `throwOnRequestTimeout`, since without that flag the SDK merely logs a warning
  and keeps waiting — the option would otherwise not mean what its name says.

  A `TimeoutError` from either is reported as retryable, so the worst case
  against a black-holed endpoint is `maxAttempts` times `socketTimeout` plus
  backoff, not an unbounded wait. A caller-supplied `client` is untouched, and
  these options are refused alongside one, like every other client option.

- **`region`, `credentials`, `endpoint`, `maxAttempts`, `retryMode` and
  `createIndexIfNotExist` are validated at construction,** which the README
  already claimed. Until now `retryMode: 'bogus'` silently became `standard`,
  `maxAttempts: -1` silently became a single attempt, `region: ''` surfaced as
  the SDK's own uncoded `Error("Region is missing")` from inside the first
  request, and `createIndexIfNotExist: 'false'` — the string an environment
  variable produces — was truthy and **created the index**. The `credentials`
  message describes the value by kind only and never echoes it.

- **Every failure a read raises is now an `S3VectorsError`.** An embeddings
  model that throws — a provider rate-limiting or falling over, the most likely
  failure a read has — escaped unwrapped from `similaritySearch`,
  `similaritySearchWithScore`, `similaritySearchWithRelevanceScores`,
  `maxMarginalRelevanceSearch` and `retriever.invoke`, while the write path
  wrapped the identical failure as `UNEXPECTED_ERROR`. A `catch` branching on
  `isS3VectorsError`, as the documentation instructs, therefore missed exactly
  the case it most needed to catch. A `relevanceScoreFn` that throws is wrapped
  the same way; it is caller-supplied code called once per result.

- **A value that is not an `AbortSignal` is refused.** It used to be read for
  `.aborted`, found wanting, and ignored — so the operation ran, uncancellable,
  while the caller believed otherwise — or, on the paths that reach `raceAbort`,
  throw a raw `TypeError` from `addEventListener` after the AWS calls before it
  had already been paid for. `null` now means "not provided" everywhere, as it
  already did for `client` and `filter`.

- **A nullish `config` or MMR `options` raises `VALIDATION`.** Both were
  dereferenced by the first check that read them.

- **A response entry that is not an object raises `AWS_INVALID_RESPONSE`.** The
  three read paths cast `response.vectors` rather than checking it, so a
  response carrying `[null]` passed through and failed later as a raw
  `TypeError` from inside a `map`.

- **A document that is not an object raises `VALIDATION`,** naming its position,
  rather than escaping as "Cannot read properties of null (reading 'id')".

- **`error.cause` is always an `Error`.** A client rejecting with a string, a
  number or `null` is legal JavaScript and made the class's own documented
  guarantee false.

- **A write no longer re-reads the caller's arrays while it runs.** `ids`,
  `documents` and `vectors` are snapshotted once, after validation, and every
  batch is sliced from the snapshot. Previously the id list was validated up
  front — uniqueness, length, type — and then re-read from the caller's own
  array as each batch was dispatched, so mutating it while the promise was
  pending wrote keys nothing had validated: duplicates, which S3 Vectors
  resolves by silently overwriting the earlier vector, or `undefined`. Reusing
  one buffer across batches, or handing the same array to two concurrent
  writes, was enough to do it by accident.

  `addVectors` and `addDocuments` also return **their own array** now rather
  than the caller's instance when `ids` was supplied. The returned list is the
  record of what was written; handing back the caller's array meant a later
  mutation could rewrite that record, and meant two writes given the same array
  shared one result.

- **Metadata values that would not survive serialisation are refused.** A
  non-finite number (`NaN`, `Infinity`, `-Infinity`), an array with a hole
  (`[1, , 3]`) and an array holding `undefined` now raise `VALIDATION` instead
  of being written. None of them were stored as passed. The AWS SDK's document
  serialiser writes a non-finite number as the *string* `"NaN"` or
  `"Infinity"`, so the field silently changed type and no numeric filter
  matched it again; and it omits a missing array element rather than sending
  `null` for it, so the array read back shorter with every later element
  shifted into the wrong position. The local byte counter, which measures
  `JSON.stringify`, disagreed with what was actually sent in both directions —
  97 bytes counted against 106 sent for one payload, 117 against 114 for
  another — so a write could be refused locally that AWS would have taken, or
  accepted locally that AWS would refuse. With these values refused, the JSON
  form and the wire form agree by construction and the counter is exact. An
  embedding that can produce `NaN` should be fixed at the source; storing the
  string `"NaN"` was never what the caller asked for.

- **`pageContentMetadataKey: '__proto__'` is refused.** It satisfied the 1–63
  character rule and then stored nothing at all: `__proto__` is an accessor on
  every plain object rather than a storable key, so the write succeeded, the
  page content was discarded in silence, and every document read back with an
  empty `pageContent`. Page content is now written with `Object.defineProperty`
  as well, so no configured key can swallow it.

### Added

- **Maximal Marginal Relevance, for real.** `maxMarginalRelevanceSearch(query,
  { k, fetchK, lambda }, callbacks?, signal?)` takes `fetchK` candidates from
  `QueryVectors`, fetches their embeddings with `GetVectors`, and selects with
  `@langchain/core`'s own `maximalMarginalRelevance` — so the ranking is core's,
  not a reimplementation. `asRetriever({ searchType: 'mmr' })` dispatches to it,
  honouring `searchKwargs`. A candidate deleted between the two calls is skipped
  rather than failing the search.
- **Enumeration: `listDocuments(options?)` and `listVectors(options?)`**, both
  async generators over `ListVectors`. An index's dimension, distance metric and
  non-filterable keys are fixed at creation, so changing any of them requires
  copying every vector to a new index — `listVectors` yields
  `{ id, vector, document }`, which is exactly what `addVectors` takes back.
  `listDocuments` is the cheaper audit form. Memory is bounded by one page
  however large the index, breaking out of the loop issues no further request,
  and `pageSize` (1–1,000) is advisory because AWS caps a page at 1 MB. Both
  need `s3vectors:ListVectors` **and** `s3vectors:GetVectors`.
- **`AmazonS3VectorsRetriever`**, returned by `asRetriever()`: core's
  `VectorStoreRetriever` plus a `signal` field that genuinely cancels the AWS
  request. Core's `BaseRetriever.invoke` never passes its config to
  `_getRelevantDocuments`, so a config signal cannot reach the request; what it
  can do it now does — an already-fired config signal rejects before any
  embedding or AWS call, and one that fires mid-query rejects the invocation
  instead of resolving with results. Previously an aborted retriever invocation
  resolved with results, having paid for a billable `embedQuery` and a
  `QueryVectors`.
- **Error classes callers can branch on.** `AWS_REJECTED` (400
  `ValidationException`, with `context.fieldList`), `THROTTLED` (429),
  `SERVICE_UNAVAILABLE` (500/503/408), `ACCESS_DENIED` (403), `QUOTA_EXCEEDED`
  (402), `CONFLICT` (409) and `KMS_ERROR` join the existing codes. Classification
  is a lookup on the exception's `name`, which is a literal type on every
  exception the service declares — never a substring match on a message.
- **Configuration is validated at construction**, before any AWS call:
  `distanceMetric`, `dataType` and `encryptionConfiguration.sseType` against the
  SDK's own enum objects, and `pageContentMetadataKey`, `nonFilterableMetadataKeys`,
  `relevanceScoreFn`, `tags` and the bucket/index names by shape and documented
  bound. A non-function `relevanceScoreFn` used to surface as an uncoded
  `TypeError` from inside a search.
- **Metadata limits are enforced locally.** AWS counts the UTF-8 byte length of
  the JSON serialisation plus a fixed 5-byte overhead — established by binary
  search against the live service
  ([`docs/evidence/metadata-limits.md`](./docs/evidence/metadata-limits.md)) —
  so the 2,048-byte filterable and 40,960-byte total caps, the 50-key limit and
  the documented value types are now checked before the round trip, naming the
  key at fault. Nested objects and arrays of objects are rejected, which the
  service does too ([`docs/evidence/metadata-value-types.md`](./docs/evidence/metadata-value-types.md)).
- **`context.attemptedIds`** on a failed write: the full resolved id list, so a
  retry with `{ ids: attemptedIds }` overwrites in place instead of minting
  fresh UUIDs for documents that already committed.
- **An evidence-guard live suite** (`test/integration/evidence-guards.test.ts`)
  with one test per undocumented behaviour this package relies on, and a
  rework suite covering enumeration, MMR, the retriever's two signals and the
  new `getByIds` shape against the real service.

### Changed

- **The index-configuration cache is gone.** A store now remembers one fact —
  that the index exists — and only when `createIndexIfNotExist` is on. Nothing
  else needs caching: AWS enforces the dimension on every write, and the
  distance metric is checked against the `QueryVectors` response on every read.
  `createIndexIfNotExist: false` therefore issues no `GetIndex` at all, and such
  a deployment needs no control-plane permission.
- **A delete now waits for an index creation already in flight** before issuing
  `DeleteIndex`, so a creation racing a delete can no longer land afterwards and
  resurrect the index.
- **Filter validation names what is wrong.** AWS answers every malformed filter
  with the string `"Invalid filter"` and nothing else
  ([`docs/evidence/filter-validation.md`](./docs/evidence/filter-validation.md)),
  so the operator vocabulary is checked locally: an unknown `$`-prefixed key
  (`$eg` for `$eq`) is rejected by name, as are the empty filter object and an
  empty `$in` array — all three confirmed to be rejections AWS makes too.
- **Search pagination is bounded only by the 1,000-page ceiling.** The
  "ten consecutive empty pages" guard is removed: a filtered search over a large
  index can legitimately produce long empty runs, and the ceiling already bounds
  the worst case.
- **Documents are always deep-copied on the way out**, not only when a duplicate
  id was requested, so two documents built from one response never share mutable
  metadata.
- **`chunk(items, size)` rejects a size below 1** instead of looping forever.
- **`raceAbort` is one helper** used by both the shared index creation and the
  retriever: the caller's wait ends, the shared work continues for whoever else
  is waiting on it, and the listener is removed on both settle paths.
- **Both peer floors are raised**: `@aws-sdk/client-s3vectors` to `^3.1133.0`
  and `@langchain/core` to `^1.2.11`, from `^3.1117.0` and `^1.2.9`. A consumer
  on an older minor of either must update. Raising a floor is a documented
  change of support, not a silent one, and the floors are what the
  peer-floors CI job installs and runs the type
  checks and the unit tier against — so the range this package promises is the
  range it is tested at, rather than a wider one nothing exercises.
- **Every dependency is at its current version**, including
  `@aws-sdk/client-s3vectors` 3.1133.0, `@langchain/core` 1.2.11 and the whole
  development set (jest 30.5.1, eslint 10.10.0, typescript-eslint 8.70.0, knip
  6.35.1, jscpd 5.2.1, fast-check 4.10.1, `@types/node` 26.6.1,
  eslint-plugin-perfectionist 5.11.1 and the rest). Every fact this package
  cites out of the two peers was re-read against the new versions: the required
  `distanceMetric` on `QueryVectorsOutput`, the literal exception names (still
  thirteen), `ValidationExceptionField` at `models_0.d.ts:94`, the optional
  `vectors` on `ListVectorsOutput`, core's retriever `invoke`, its MMR dispatch
  and its `maximalMarginalRelevance` signature. All still hold, and the
  citations name the versions they were re-read at.

  The SDK floor moves with it, to `^3.1133.0`, because the floor, the
  installed version and the cited version have to be one version here. The
  peer-floors job installs the floor and runs the unit tier against it, and
  `dependency-citations.test.ts` requires every citation to name the version
  that is installed — so a floor left one release below the cited version fails
  that job by construction. It did, which is how this was found.

- **Every pinned GitHub Action is at its current release.**
  `github/codeql-action` (`init`, `analyze`, `upload-sarif`) moves 4.37.9 →
  4.38.0, and `softprops/action-gh-release` 3.0.2 → 3.0.3. Each is pinned by
  commit SHA with the tag in a trailing comment, as every action in this
  repository is; each SHA was resolved from the upstream annotated tag rather
  than copied from a bump notification, and the method was checked by resolving
  the tag already pinned and confirming it matched.
- **The source is split by responsibility** — `actions/` (one operation each),
  `internal/` (request-shaped helpers) and `shared/` (pure helpers) — with a
  contract in the JSDoc of every exported function stating what it accepts,
  returns, throws and guarantees.

- **The scheduled live-AWS workflow is removed.**
  `.github/workflows/integration-live.yml` ran the live suite every night
  against whatever `main` happened to be, which is not the commit anyone was
  looking at, and spent real money on every night the repository was untouched.
  A green run nobody reads is not evidence. The live suite itself stays exactly
  where it was — `npm run test:integration`, against a bucket created and
  deleted for the run — and everything the workflow enforced still holds when
  you run it: `RUN_LIVE_INTEGRATION=1` with no `AWS_VECTOR_BUCKET` is fatal
  rather than a silent skip. `docs/evidence/` now says in as many words that
  nothing re-runs these probes on a schedule, so a claim there is only as fresh
  as the date it records. `release.yml` is unaffected: its CI gate counts the
  check runs on the tagged commit, and a scheduled workflow never produced one.

### Fixed (found by the verification work)

- **A decided behaviour had never been implemented.** Auditing all 38 entries
  of the design's decision log against the code found two that were decided and
  then missed: `context.batchSize` on a write failure (D-24) and the split of
  index deletion out of `delete` (D-10) — the latter chosen explicitly during
  the design review. Both are now implemented; the other 36 check out.

- **A 503 did not say how big the batch was.** The design decided that a write
  failure would carry the batch size, because AWS answers an oversized batch
  with the same `ServiceUnavailableException` it uses for genuine
  unavailability and nothing else separates them. The decision was never
  implemented. `context.batchSize` is now set on every `PutVectors`
  failure, through the same decorator that preserves the original stack.

- **MMR did not validate its filter.** `maxMarginalRelevanceSearch` checked it
  in the store but `mmrSearch` did not, so the action was one refactor away
  from sending an invalid filter to AWS. It now validates like
  `searchByVector`, and the store no longer duplicates the check.
- **A filter rejection told only half the callers what to do.** An array got
  "Omit the filter argument entirely to search without filtering"; a `Map`, a
  `Date` or a string got nothing. Same mistake, same remedy — now both say it.
- **An unobservable abort check was removed** from `mmrSearch`: `queryPages`
  checks before its first request and nothing billable happens in between, so
  a second check there could not change any outcome.

- **An error could name an internal step instead of the call the caller made.**
  `addVectors` aborted with `operation: 'ensureIndexExists'`, and
  `similaritySearch` and `similaritySearchWithRelevanceScores` both reported
  `similaritySearchWithScore`, because they delegate. `context.operation` is
  how a caller finds the call site, so a delegate's name sends them to the
  wrong one. The three text searches now share one private path that is told
  which public method it serves, `addVectors` checks its own signal, and the
  index lifecycle takes the caller's operation so an abort while waiting on a
  shared index creation still names the write.
- **`delete({ ids })` did not reject an already-fired signal.** Every other
  entry point refuses before any request; this one threaded the signal into
  `DeleteVectors` and let the SDK reject each batch instead, issuing N
  cancelled requests where the contract promises none.

### Verification

- **The contract is executable.** This is the change the rest of this release
  hangs off. Every contract here was written, reviewed and linted, and none of
  it was ever *run*: a doc block promising `S3VectorsError` passed every gate
  there was while the function threw a raw `TypeError`, and 100 % coverage only
  ever measured the lines the inputs we happened to choose reached. An audit of
  the finished package found thirty defects living in exactly that gap.

  `test/contract/registry/` closes it. Each public entry point is declared as
  data — the closed set of codes that may escape it, the context each code must
  carry, its accepted input domain, the AWS calls it makes and in what order,
  and its concurrency ceiling. A shared corpus then drives every declaration on
  two axes: 32 hostile input values, and 13 *ambient* conditions that are not
  inputs at all — a provider that throws, a client that rejects with a string, a
  malformed response, a throttled call, an access denial. Six properties run
  over the result. The load-bearing one is P2: an input outside the accepted
  domain must be refused **before any AWS call and before any billable embed**.
  A property that only inspects what escapes cannot see a silent corruption, and
  the silent findings never threw at all.

  The known-gap ledger is enforced in both directions — an unlisted failure
  fails the run, and so does an entry that has stopped reproducing, so it cannot
  rot into a list of things nobody has looked at since. It is empty.

- **Mutation-sampled, not just covered.** Over 1,100 mutations were applied
  across every module in twenty-four rounds and the suite re-run for each —
  comparison and logical flips, numeric and boundary changes, removed
  `await`s, **deleted statements** and **altered string literals**. Every
  survivor was a real gap and every one is fixed: an asserted branch whose
  *output* nothing checked, a `&&` that could move a metadata field named
  `"null"` into page content, stack-provenance tests that checked the old
  stack was gone rather than that the new one had frames, a non-object
  `$metadata` that let a non-AWS error be reported as a retryable AWS one, an
  unpinned cause-walk depth bound, an abort check whose deletion would have
  cost a billable embed, and an MMR filter that was validated only by its
  caller. The last five rounds — roughly 275 mutants — produced no
  behavioural survivor at all; the one mutant that still survives the unit
  suite is type-level, and `tsc` rejects it.

  That sampling was done before the audit remediation above, against code this
  release then changed substantially, and the tooling is no longer in the
  repository — so read it as how the suite was hardened, not as a standing
  measurement of the code that ships. What stands is the conformance run.
- **Every error message is read by a test.** 78 error-construction sites; an
  audit found 61 whose message no assertion touched, so a refactor could have
  swapped two messages — or dropped the half that says what to do — without
  anything failing. The actionable half is now asserted wherever it exists:
  the option to set, the limit exceeded, the permission missing, the field
  holding the ids already written.
- **Properties over whole domains** (`test/property/pure-functions.property.test.ts`):
  `chunk` round-trips and never yields an empty or oversized batch; every
  offset indexes back into the array it came from; `resolveWriteIds` returns
  one id per document and prefers the caller's; `validateFilter` throws nothing
  but a coded `VALIDATION` for *any* input at all and accepts every filter
  built from documented operators; `classifyAwsError` is total; `toError`
  always returns an `Error` and preserves an Error-shaped input's identity;
  `createDocument` round-trips page content and never shares mutable metadata
  between two documents built from one vector.

- **The documentation is checked against the API** (`test/contract/documented-api.test.ts`):
  every method, static factory, error code and package export a doc names must
  exist. Verified against the three lies this rework actually had to correct —
  a removed method, a removed error code and an export that never existed.
- **Every error names what raised it** (`test/contract/error-operation.test.ts`),
  for all eleven entry points, the retriever, the callbacks-slot guard and an
  abort during a shared index wait. The rule is the one `internal/operation.ts`
  states: `context.operation` is the caller's own method — `addDocuments`,
  `similaritySearch` — except on a failure raised by an AWS request itself, where
  it is that command (`PutVectors`, `DeleteVectors`, `GetIndex`, `CreateIndex`,
  `DeleteIndex`), because that is the call that failed. This entry previously
  claimed the public method in every case, which the code never did and was never
  meant to.

- **Two more gates, each verified against the defect it prevents**: an
  unhandled promise rejection or a listener-leak warning now fails the test run
  (this package is full of deliberately un-awaited promises — a shared index
  memo, `allSettled` groups, a write window that settles out of order — and
  Jest only prints those by default); and every link in the shipped
  documentation must resolve, anchors included, which caught the badge-link
  blind spot in the checker itself before it caught anything else.

- **Every dependency citation is checked against the installed package**
  (`test/contract/dependency-citations.test.ts`). A contract cites the fact it
  rests on as `package@version path:line`; nothing re-read those when the
  packages moved, so a bump silently turned evidence into decoration. All 17
  citations must now name the version that is installed, and every file and line
  they point at must exist and carry code. The same suite reads the exception
  names out of `@aws-sdk/client-s3vectors`'s own service model and requires
  `classifyAwsError` to map each one to something other than the catch-all, so
  an exception added by a future SDK fails the build instead of being reported
  as a generic request failure. Verified against all three: a stale version, a
  line number that has slid off the end of a file, and a removed mapping.
- **Every sample in the documentation is compiled** (`npm run check:docs`, run
  in CI). The name checks above cannot see a signature: `delete` stayed a real
  method when its parameters changed, so a README snippet calling it the old way
  passed every gate there was. All 34 TypeScript samples in the README, the
  guide, the stability policy (since removed) and this changelog are now
  type-checked against `src/` — with the context a snippet assumes (`store`,
  `embeddings`, …) supplied as ambient declarations of the real types, so only
  the setup is elided, never the checking. One block is marked as illustrative,
  with its reason, and the count of such marks is asserted. Verified against a
  snippet rewritten to call the old `delete`, which it rejects. It found four
  defects in the documentation on its first run: a block declaring `const store`
  twice, a filter over an `ids` array the snippet never defined, an upsert round
  trip that dereferenced a `getByIds` result the API documents may be
  `undefined`, and a client built with an empty object for its credentials.
- **The audits are gates now** (`test/contract/source-contracts.test.ts`).
  Every exported function must carry a contract naming what it returns and
  throws; every interface field must carry a doc line; no doc block may sit
  immediately above another, which is what a contract left behind by a moved
  function looks like; and the source must stay free of `TODO`, `any`,
  `@ts-ignore`, `eslint-disable`, `console.*` and `instanceof`. Written after
  exactly that drift happened twice during this rework — the checks find the
  third instance, in `_selectRelevanceScoreFn`, on their first run.

### Documentation

- Every exported function, every private helper and all 139 interface fields
  carry a contract or a doc line. The fields every action shares — the client,
  the operation name, the signal, the batch size and the concurrency cap — are
  documented once on `internal/operation.ts` and inherited, which removed 25
  duplicate declarations rather than adding 25 duplicate comments.
- The largest functions were split where the split had a name worth giving:
  `assertValidConfig` (93 lines, cyclomatic 25) into eight per-option
  validators, `fetchVectorsByKey` (78/21) into three, `validateFilter` (69/21)
  into four, plus `queryPages`, `listPages`, `createIndexLifecycle`,
  `assertCreatable`, `awsDiagnostics`, `mmrSearch` and the constructor. What is
  left above the thresholds is a pagination loop and an optional-field
  extractor, where the branches are the algorithm.
- README and `src/guide.md` are rewritten against the new
  behaviour: the error-code table, the `getByIds` contract, MMR, enumeration,
  the two retriever signals, the IAM policy (now including
  `s3vectors:ListVectors`) and what construction validates. Every reference to
  the Python `langchain-aws` package is gone: this package is specified against
  AWS's documentation and `@langchain/core`, not against another implementation.
- `docs/evidence/` records each live probe with its raw request and response,
  and the README says which claims rest on it.
- **The documentation was audited against the code, and four claims it made
  were wrong.** `createIndexIfNotExist`'s JSDoc said a `GetIndex` is issued on
  every instance's first write "regardless of this flag", and that it validates
  the index's dimension and metric; neither is true — `false` issues no
  control-plane call at all, and `indexExists` reads no field of the response.
  The `client` option and the options it is exclusive with were documented as
  "ignored" when supplied together, which has been a rejection since this
  rework. `S3OutputVector` was described as the input type of an exported
  `createDocument` helper, which is not exported. The README's
  *Non-Filterable Metadata Keys* section still said the metadata byte caps
  "aren't checked locally" and that a local check was unsafe, contradicting its
  own limits table and the evidence probe that settled the counting rule. Each
  is corrected at the source, so the generated reference under `docs/` is
  correct too.
- **`src/guide.md` documented a relevance conversion that no longer exists.**
  It listed a built-in euclidean formula (`1.0 - distance / √4096`) as one of
  two; `euclideanRelevanceScoreFn` was removed above, and a euclidean index
  with no `relevanceScoreFn` raises `VALIDATION`. The guide also described
  `delete()` as having an "entire index" mode and put peak ingest memory at one
  batch rather than the pipeline window.
- **The README's *Metadata Value Types* section described the old behaviour.**
  A `Date`, an `undefined`, a `null` and a nested object were documented as
  silently converted, silently dropped, or rejected by AWS; all four are now
  rejected locally with `VALIDATION` naming the key. `SUPPORT.md` still pointed
  readers at `deleteAll`, and the IAM section attributed `s3vectors:DeleteIndex`
  to `delete()` rather than to `deleteIndex()`.
- `docs/STABILITY.md` is removed. What a consumer needs from it now lives where
  it is read: the supported Node, module-format, TypeScript and peer ranges in
  the README's *Runtime Requirements* and *Testing* sections, the storage
  layout in *Metadata Value Types* and *Disabling Page-Content
  Round-Tripping*, the error contract — append-only codes and the stable
  `isS3VectorsError` brand — in *Errors*, and the semver and deprecation rules
  in `CONTRIBUTING.md`'s *Release Process*.
- `CONTRIBUTING.md` says where behaviour comes from — the S3 Vectors API
  reference, the SDK service model, `@langchain/core`'s source, or a recorded
  live probe with a test guarding it — replacing the section that told
  contributors to track another implementation of this store and port its
  fixes. The feature-request template asks for the primary source behind a
  proposal instead of whether that package does the same. A test holds the rule
  in place across the contributor documents and issue templates.

- **`awsErrorName` and `retryable` are documented as what they are:** set on
  every error whose cause is AWS-shaped, whatever code that error was given, not
  only on `AWS_REQUEST_FAILED` and `NOT_FOUND`. `AWS_REJECTED` carries
  `"ValidationException"`; `THROTTLED` carries `"TooManyRequestsException"`. The
  `retryable` field no longer names an exception the service cannot send.
- **`pagesScanned`** is documented as being set on every listing failure,
  including one on the first page where it reads `0`, which is an answer rather
  than an omission.
- **`foundIds`** is documented as being set by MMR as well as `getByIds`, which
  fetches its candidates the same way.
- **`context.operation`** is described by the rule the code actually follows: the
  caller's own method, except on a failure raised by an AWS request itself, where
  it is that command. An earlier entry claimed the public method in every case,
  which the code never did.

- **The documented IAM policy was missing `s3vectors:TagResource`.** AWS
  requires it in addition to `s3vectors:CreateIndex` to create an index with
  tags (`CreateIndexInput.tags`), so a store configured with `tags` and the
  README's policy — presented as the complete least-privilege set, "no
  `s3vectors:*` wildcard" — failed its first write with an
  `AccessDeniedException` naming a permission the reader had been told they did
  not need. The action never appears in a log of its own, because tags travel
  inside the `CreateIndex` request. `index-lifecycle.ts` had said so in a
  comment since the option was added; the policy a reader actually pastes did
  not.

- **The `connectionTimeout`, `socketTimeout` and `requestTimeout` options were
  absent from the README's configuration table.** They exist, are validated at
  construction and change how a hung request behaves, and were reachable only by
  reading the type definitions. The table also still described the constructed
  client as built from "exactly `region`, `credentials`, `endpoint`,
  `maxAttempts` and `retryMode`", which stopped being true when those three
  options started setting a `requestHandler`.

- **Ten further claims that the code contradicted are corrected.**
  `pageContentMetadataKey: null` was documented as storing page content "as an
  empty string" when no key is written at all; `nonFilterableMetadataKeys` was
  documented with a 10-key exemption that does not exist (exceeding the cap is
  refused, and the section two screens down said so); a lost index-creation race
  was described as "re-validating against whichever writer actually won", when
  nothing is re-read; `deleteIndex` was missing from the list of methods that
  accept an `AbortSignal`; `similaritySearchVectorWithScore` was shown with an
  optional `k` that is required, and `src/guide.md` showed the three text
  searches with a required `k` that defaults to `4`; the `NOT_FOUND` and
  `INDEX_CONFIG_MISMATCH` enum docs described conditions neither is raised for;
  `getByIds`'s `@throws` contradicted its own remarks about absent ids;
  `relevanceScoreFn` was documented as falling back to "a built-in function
  selected based on the configured `distanceMetric`", when a euclidean index has
  no built-in and fails closed instead; `AmazonS3VectorsConfig` presented
  `embeddings` and `client` as alternatives to each other, which they are not;
  and the issue template and CI workflow still referenced `addTexts` and a
  stability policy that had both been removed.

- **Two of those classes of drift now have a gate.**
  `test/contract/documented-config.test.ts` derives the actions this package can
  issue from the `new …Command(` sites in `src/` and asserts the README's IAM
  policy grants exactly those, plus the permissions AWS requires without a call
  of their own; it also asserts the configuration table has a row for every
  field of `AmazonS3VectorsConfig`, which is what would have caught the missing
  timeouts. `test/contract/documented-signatures.test.ts` parses each documented
  signature and asserts its arity, and which arguments may be omitted, match the
  method — the check that catches a `k?` that is required. Both were run against
  the defects above and fail on each.

- **The documentation was read end to end against the code, and eight more
  claims were wrong.** The worst was in *Infrastructure Setup*: the
  `aws s3vectors create-index` snippet a reader is told to run omitted
  `--metadata-configuration`, and an index created that way reports an empty
  non-filterable key list — which this store now refuses to write to with
  `INDEX_CONFIG_MISMATCH`, and which cannot be corrected afterwards because the
  list is fixed at creation. Verified by running the README's own command
  against live AWS, writing through the library, and watching it fail; then
  re-running with the flag and watching it pass. The CLI snippet, the console
  steps and the CDK note now all state the rule.

  The CDK note was stale in its own right: it said to use a raw `CfnResource`,
  but `aws-cdk-lib` (checked at 2.269.0) ships typed L1 constructs for both
  resources — `aws_s3vectors.CfnVectorBucket` and `aws_s3vectors.CfnIndex`. A
  worked snippet replaces the advice. There are still no L2 constructs.

  The rest: the *Retries* section named `ThrottlingException` as a name this
  service sends, which is one of the three invented names removed from the code
  in this release — S3 Vectors sends `TooManyRequestsException`; two code
  comments still listed the five options `client` is exclusive with, which
  became eight when the timeouts arrived; the guide's `INDEX_CONFIG_MISMATCH`
  and `VALIDATION` rows described narrower conditions than the code raises; and
  the project tree omitted three modules this release added
  (`internal/output-vectors.ts`, `shared/objects.ts`, `shared/aws-limits.ts`)
  while describing `actions/delete.ts` as still able to destroy the index and
  `index-lifecycle.ts` as exporting an existence check.

- **Two filter behaviours the README asserted now have evidence and a guard.**
  A type-mismatched comparison (`{ popular: { $eq: 'true' } }` against a stored
  boolean) matches nothing without erroring, and filtering on a non-filterable
  key is rejected outright. Both were stated as "confirmed live" with nothing
  re-checking them, which is the one thing `docs/evidence/README.md` says a
  citable claim may not be. They are recorded as T3-12 and T3-13 with their raw
  traffic, and the live suite now fails if AWS changes either answer.

## [1.0.0-rc.1] - 2026-09-02

The 1.0.0 release candidate, published under the `next` dist-tag. Every finding of an in-depth pre-1.0 review of the package as a whole — source, public types, error surface, CI/release pipeline and documentation — against the bar of "safe to depend on in an enterprise production system" is fixed; the package ships an ESM and a CommonJS build; and `docs/STABILITY.md` stated what every `1.x` release promised to keep. No wire-format or storage-format change: everything written by 0.9.0 reads back identically, and 0.9.0 reads everything this version writes.

### Breaking

- **Node.js 22 or later is required** (`engines.node: ">=22"`). Node 20 reached end of life on 30 April 2026 and is no longer tested; the CI matrix runs Node 22 and 24 on Linux, macOS and Windows. Both peer dependencies still accept Node 20 and nothing in this package's runtime needs a newer API, so a deployment pinned to Node 20 can stay on 0.9.0 — but a supported floor below a maintained Node line is not a promise a 1.0 should make.
- **`similaritySearchWithRelevanceScores` no longer accepts an `AbortSignal` in its 4th argument.** That position is the `Callbacks` slot on every text-based search, and the method's two siblings have rejected a signal there with a coded `VALIDATION` error since 0.9.0; this one kept honouring it as a back-compat affordance from the versions that expected it there. The 4th parameter is now typed `Callbacks` (a signal there fails to compile from TypeScript, and is rejected with `VALIDATION` before the billable `embedQuery` call from JavaScript) and the signal goes in the 5th, as on its siblings. A call that already passed the signal fifth is unaffected.
- **Write calls now reject empty-string and duplicate ids.** `addDocuments`, `addVectors` and `fromDocuments` previously forwarded whatever was in `ids` / `document.id` verbatim: an empty string reached AWS and failed there with an opaque `ValidationException`, and a duplicated id within one call silently overwrote its earlier sibling inside the same `PutVectors` batch. Both now fail fast with a `VALIDATION` error naming the offending position, before any embedding is spent. Ids that were valid before are unaffected.
- **`error.context.instance` is no longer enumerable.** Factory errors (`fromDocuments`, `fromTexts`, `fromExistingIndex`) still attach the constructed store so callers can recover partial writes, but the property is now defined non-enumerable so `JSON.stringify(error.context)` / `util.inspect` / structured loggers no longer serialise the whole store — and the credentials inside its client — into logs. Direct access (`error.context.instance`) works exactly as before; only `Object.keys`, spread and serialisation stop seeing it.

### Fixed

- **Credentials could leak through LangChain serialisation.** `VectorStore` records constructor arguments in `lc_kwargs`, and this store's config object carries `credentials`, a fully built `client`, and the embedding models (which often hold their own API keys). `lc_kwargs` now carries redacted placeholders for those four fields, and a regression suite asserts that `util.inspect`, `JSON.stringify` and `Object.keys` over the store *and* over its thrown errors never contain a configured secret.
- **A stale index cache survived an out-of-band index delete/recreate.** The first-write `GetIndex` result is cached for the instance lifetime; if the index was then deleted and re-created with a different dimension or metric, every subsequent `PutVectors` failed forever with the same AWS error while the store believed the index was validated. A `PutVectors` that fails with `NotFoundException` or `ValidationException` now drops the cached descriptor and bumps the index epoch, so the *next* write re-validates (and re-creates, if configured) instead of repeating the failure; the surfaced error carries `context.indexCacheInvalidated: true` and says so in its message.
- **Auto-created indexes ignored encryption and tags.** `createIndexIfNotExist` issued a bare `CreateIndex`, so a store used in an account that mandates SSE-KMS created an unencrypted (SSE-S3) index with no cost-allocation tags. New `encryptionConfiguration` and `tags` config fields are forwarded to `CreateIndex`; they are documented as applying *only* to auto-creation, since an existing index's encryption cannot be changed.
- **The IAM guidance for `createIndexIfNotExist: false` was wrong.** The README implied that disabling auto-creation removed the need for `s3vectors:GetIndex`. It does not: the first write always calls `GetIndex` to validate dimension and metric, so a role scoped to `PutVectors`/`QueryVectors` alone failed on its first write with `AccessDeniedException`. The docs now state the requirement plainly and distinguish "bucket missing" from "index missing" in the resulting error.
- **Filters built in another realm were rejected.** `isPlainFilterObject` tested `Object.getPrototypeOf(x) === Object.prototype`, which is false for a plain object from a `vm` context, a worker `postMessage`, or `structuredClone` in some runtimes. It now accepts any object whose prototype is `null` or whose prototype's prototype is `null` — the shape of a plain object in every realm — while still rejecting class instances, arrays, `Map`s and the like.
- **`addDocuments`, `addVectors` and `fromDocuments` demanded `Document` class instances.** `@langchain/core`'s own `VectorStore` signatures accept `DocumentInterface`; ours narrowed to `Document`, so documents produced by another LangChain package build, or a `structuredClone`'d copy, failed to type-check. Parameters are now `DocumentInterface[]`, matching the base class. Return types are unchanged.

### Added

- **A CommonJS build.** The package was ESM-only, so `require()` worked only where Node's `require(esm)` does (20.19+, 22.12+), and TypeScript's `node16` resolution reported the `require` condition as landing on an ES module. `dist/` now holds an ESM tree and a CommonJS tree compiled from the same source, and the `exports` map serves `import` the first and `require` the second, each with its own declarations. `isS3VectorsError` already brands with a shared `Symbol.for`, so a process that loads both copies still recognises either one's errors. Verified by publint, arethetypeswrong (`node16` from CommonJS, `node16` from ESM, bundler) and a package smoke that installs the tarball and uses it from ESM, CommonJS and a TypeScript 5 consumer with `skipLibCheck` off.
- **AWS diagnostics on every wrapped error.** `S3VectorsError.context` now carries `awsErrorName`, `httpStatusCode`, `requestId` and `retryable` when the cause is an AWS SDK error, and the message names them inline (`PutVectors failed (ThrottlingException, HTTP 429, requestId …): …`) so a log line alone is enough to open an AWS support case. `retryable` is derived from the SDK's `$retryable` marker, the documented transient exception names, and HTTP 429 / 5xx status, and is the intended input for a caller-side retry/backoff layer on top of the SDK's own retries.
- **`maxConcurrentBatchCalls` config option** (default `10`, positive integer). Caps how many `PutVectors` / `DeleteVectors` / `GetVectors` calls the store keeps in flight at once. Lower it when sharing a bucket's request quota with other producers; raise it on dedicated buckets with high write volume.
- **`addDocuments` pipelines embedding against upload.** Previously each concurrent group waited for *all* of its `embedDocuments` calls before issuing any `PutVectors`, so the upload path idled during embedding and vice versa. Batches are now embedded one at a time (preserving the sequential, rate-limit-friendly embedding behaviour) while previously embedded batches are already uploading, with at most `maxConcurrentBatchCalls` uploads in flight. Partial-failure semantics are unchanged: `context.writtenIds` still lists exactly what reached AWS, and an abort signal is still honoured between every batch — now also *after* an embed and before its upload.
- **`docs/STABILITY.md`** (since removed) stated what every `1.x` release promises: the public export set, the layout of what the store writes to S3 Vectors, append-only error codes and the stable `isS3VectorsError` brand, the supported Node, TypeScript and peer ranges with the check that verifies each, the deprecation rule, and the Python-parity choices that are deliberate. `SUPPORT.md`, issue templates (bug report, feature request) and a pull-request template pointed at it. The README's Testing section now states what each test tier proves and what nothing proves, and its description of the live-AWS workflow matches what the workflow does (nightly, an ephemeral bucket, a zero-tests-ran guard). The JSDoc for `S3VectorsErrorContext.awsErrorName` named an `INDEX_NOT_FOUND` code that does not exist; it is `NOT_FOUND`.
- README: a Non-goals section (no `ListVectors`, bucket lifecycle, retry layer or client-side metadata-size enforcement); a Rate Limits, Payload Limits and Cost section quantifying the per-call caps this store's batching is sized to and how they map to billing; a note that `asRetriever().invoke()` does not forward an `AbortSignal`; a section on the strict `getByIds` contract and recovering `context.foundIds`; and a list of which `S3VectorsClientConfig` fields are passed through when the store builds its own client.

### Repository hygiene

- `package.json` declares `"sideEffects": false`, letting bundlers drop unused exports.
- `stripInternal` is enabled, so members tagged `@internal` no longer appear in the published `.d.ts` files. `S3OutputVector` and friends are re-labelled "output / parameter types" — they were never internal, they are what `getByIds`-adjacent callers see.
- Type-aware ESLint now also covers `test/**` (via `tsconfig.test.json`), with the handful of rules that fight idiomatic Jest mocks relaxed for that directory only.
- CI: the lint job additionally runs `typecheck:types`, `knip` (unused exports/files/deps), `depcheck`, and a docs-drift check that regenerates the API docs and fails on any diff; a new `package-smoke` job packs the tarball and imports it from a fresh project to catch `exports`-map and file-list mistakes; `npm audit` no longer passes `--omit=dev`, so peer and dev dependencies are audited too. Unit-test timeout lowered from 30 s to 10 s so a hung mock fails fast instead of stalling the run.
- The tarball no longer ships `.d.ts.map` files: they pointed at `src/`, which the tarball omits, so every one was a dead link. `.js.map` files stay, with the TypeScript source inlined, so stack traces land on `.ts` lines. `npm run pack:check` (the pack listing, publint and arethetypeswrong) guards the published shape in CI, as a release gate and through `prepublishOnly`; it packs its own tarball with a clean npm environment, because `npm publish --dry-run` exports its dry-run setting to every lifecycle script and a tool that shells out to `npm pack` on its own then gets no tarball at all. `exports['./package.json']` is available to tooling that reads the manifest.
- The generated API reference links to `main` instead of the commit it was generated at, and no longer bakes in the package version. A regeneration at any commit is now byte-identical, which is what lets the CI drift check pass at all: previously every commit moved the SHA in every `Defined in` link, so the check could only ever fail. A version bump no longer rewrites every docs file either.
- Release workflow: refuses to publish when the git tag disagrees with `package.json`'s version; pins the `npm` version used for trusted publishing; runs `typecheck:test`, `typecheck:types` and the package smoke test as release gates; and logs an `npm publish --dry-run` file list before the real publish.
- Release workflow: a prerelease version (one containing `-`, such as `1.0.0-rc.1`) publishes under the `next` dist-tag and as a prerelease GitHub release, so a plain `npm install` keeps resolving to the last stable version; a plain version goes to `latest`. Publishing now also waits for every check run on the tagged commit to succeed — the OS × Node matrix, the package checks, the audit, CodeQL and Scorecard — so a tag on a commit that never went through CI, or whose CI failed on one operating system, cannot publish. `prepublishOnly` runs `pack:check`, so a publish from anywhere is refused when the tarball's shape is wrong.
- CI: a `peer-floors` job installs every declared peer at the floor of its range and runs the type checks and the unit tier against it, since the lockfile installs newer versions and nothing else proves the floors. The hygiene job also runs jscpd (duplicated source), actionlint (workflow syntax, expression types and shellcheck over every `run:` block) and, on pull requests, requires a `CHANGELOG.md` entry for any change under `src/`.
- `SECURITY.md`: the supported-versions table is now version-agnostic ("latest minor of the current major"), and the scope section spells out what the library does and does not do with credentials.
- **The test suite had no TypeScript project covering it.** `tsconfig.json` builds only `src/` and explicitly excludes `test/`, so `npm run typecheck` — and CI's typecheck job — never looked at a single test file. ts-jest doesn't fail a run on type errors either, so 32 of them had accumulated while every gate reported green, visible only as squiggles in an editor. Fixed the 32 (a shared `indexFixture` for mocked `GetIndex` payloads, and a `sendOptionsOf` accessor for the `send(command, options)` argument that `aws-sdk-client-mock` types as a 1-tuple), and added `tsconfig.test.json` plus a `typecheck:test` script wired into CI so the gap can't silently reopen. Test-only; no shipped code changed.

## [0.9.0] - 2026-08-29

Remediation of an independent code review run against the v0.8.0 tag. That review closed every prior finding and reported none of its own still open, so this release comes from a fresh full read of the source plus direct verification of the assumptions the previous round left standing. Two of the five findings were reproduced with a probe before being fixed; one of them was pinned as *intended* behaviour by the existing test suite.

### Breaking

- `similaritySearch` and `similaritySearchWithScore` now throw a coded `VALIDATION` error when an `AbortSignal` is passed as the 4th argument. That position is the `Callbacks` slot, and a signal there was silently discarded: the search ran to completion, uncancelled, after already spending a billable `embedQuery` call. Pass the signal as the 5th argument. `similaritySearchWithRelevanceScores` is unchanged — it historically accepted the signal in that slot, so honouring it there remains a documented back-compat affordance.
- The `QueryVectors` page guard no longer stops at a flat 100 pages. `QUERY_PAGE_LIMIT_EXCEEDED` now fires on lack of *progress* (10 consecutive result-less pages) or a 1,000-page runaway ceiling, and its message names which one fired. Searches that previously failed at page 100 while still making progress now succeed.

### Fixed

- **`addDocuments` kept embedding after the abort signal fired.** The signal was checked once per concurrent group rather than once per batch, so a signal firing partway through a group still let every remaining batch in it spend a full, uncancellable, billable embedding call — up to 9 extra calls, or roughly 1,800 documents at the default `batchSize` of 200. Reproduced before the fix: aborting during the second embed call still produced 11 `embedDocuments` calls instead of 2. An abort mid-group now also reports `context.writtenIds`, like every other partial failure.
- **The page guard failed legitimate searches.** `MAX_QUERY_PAGES` was exactly `MAX_TOP_K / 100`, resting on the belief that AWS always fills a page to 100 results. AWS documents the limit as "Results per page in a QueryVectors response: **up to** 100" — a maximum, not a guarantee — so a shorter page is a conforming response and the cap had zero headroom: one 99-result page anywhere in a `k = 10,000` search pushed it to 101 pages and rejected a valid query. The suite pinned this as intended behaviour (one result per page with `k = 500` asserted failure at page 100, though that search converges at page 500).
- **Decorating an error destroyed its stack trace.** Three paths rebuild an error to attach context — partial ids, a factory's constructed instance, pagination state — and each had to construct a new `S3VectorsError`, since `message` and `context` are readonly once set. A fresh `Error` captures a fresh stack, so the decorator became the apparent origin: an abort raised in `_checkAborted` reported `at AmazonS3Vectors._attachPartialIds` as its top frame. Worse on validation failures, which carry no `cause`, so the original site was lost outright rather than merely demoted. All three now carry the original frames over, falling back safely when a stack is absent or in another engine's format.
- **A nullish AWS response surfaced as a raw `TypeError`.** `_send` wraps only the AWS call, so the property reads on a resolved response sit outside its `catch`. `QueryVectors` and `GetVectors` responses are now checked for being an object at all before any field is read, throwing `AWS_INVALID_RESPONSE` — the same guarantee the existing field-level guards already gave, for the same non-conforming-client population.

### Added

- A `QueryVectors` failure on a continuation page now explains itself: it names the page it was on and how many results it had collected, and points at re-issuing the original query. AWS documents pagination tokens as valid for only "several minutes" and publishes no dedicated expired-token exception, so this is keyed on what the library knows for certain — that the failing call carried a `nextToken` — rather than on a guessed exception name. A first-page failure and a caller-driven abort pass through unchanged.

### Repository hygiene

- **The nightly live-AWS CI job could report success having run zero tests.** A skipped Jest suite exits 0, so "the env was never set" and "every live test passed" were indistinguishable from the job's exit code — a dropped env line or an unset secret would have turned the live run green without a single AWS call. `RUN_LIVE_INTEGRATION=1` with a missing `AWS_VECTOR_BUCKET` is now fatal rather than a silent skip (an unset `RUN_LIVE_INTEGRATION` still opts out cleanly), and the workflow additionally fails if the run reports zero passing tests.
- **The shared example harness asserted on the wrong property.** `expectThrow` compared `error.name` against an error *code*; since every error here has `name === 'S3VectorsError'`, that could never match and silently degraded to a substring match on the message, which passes whenever the text merely happens to contain the string. Replaced with `expectErrorCode`, which asserts on `error.code`, and the duplicate local copy in `verify-edge-cases.mjs` now uses it too.

### Notes

- Every AWS limit the library encodes was re-verified against AWS's published limits page rather than carried forward: `topK` ≤ 10,000, PutVectors/DeleteVectors ≤ 500, GetVectors ≤ 100, non-filterable metadata keys ≤ 10, filterable metadata ≤ 2 KB, dimension ≤ 4,096. All matched.
- The prior review's two open uncertainties (IM1, IM4) needed no new regression tests: both are already exercised by the mocked unit suite, which runs at 100% branch coverage. What neither has is a *live* trigger, and the review itself established that none can exist.

## [0.8.0] - 2026-08-29

Remediation of an independent code review run against the v0.7.0 tag, plus three defects found while verifying that review's own claims. Every finding below was reproduced before being fixed.

### Breaking

- A `config.client` that is not an `S3VectorsClient` now throws a coded `VALIDATION` error instead of emitting a `console.warn` and silently building a replacement. The replacement was constructed from the ambient credential chain and default region, so a caller who passed an explicit but wrong client could silently read and write against a different AWS account. `client: null`/`undefined` is unaffected — it is read as "not provided", the same way a `null` filter is already read as "no filter".
- A malformed or absent `distanceMetric` in a `QueryVectors` response now reports `AWS_INVALID_RESPONSE` rather than `INDEX_CONFIG_MISMATCH`. The two conditions were conflated under one code; a *valid* metric that disagrees with this store's configuration still reports `INDEX_CONFIG_MISMATCH`.
- A search that hits the 100-page `QueryVectors` limit with more pages available and fewer than `k` results collected now throws the new `QUERY_PAGE_LIMIT_EXCEEDED` instead of silently returning a short result set.

### Added

- `S3VectorsErrorCode.QUERY_PAGE_LIMIT_EXCEEDED`, with `context.pagesScanned` and `context.resultsCollected`, so a truncated search is distinguishable from one that legitimately exhausted its matches.
- `similaritySearchWithRelevanceScores` now accepts an `AbortSignal` in its fifth parameter, matching `similaritySearch` and `similaritySearchWithScore`. The fourth parameter accepts `Callbacks | AbortSignal` so the historical call style keeps working.
- A regression test asserting that `S3VectorsErrorContext.instance` never serializes client internals, and an explicit `lc_serializable = false` on `AmazonS3Vectors` so that guarantee no longer rests on an unpinned `@langchain/core` default.
- A README table documenting every `S3VectorsErrorCode` and when it is raised.

### Fixed

**Silent data corruption:**

- `addVectors`/`addDocuments`/`addTexts` never checked that a caller-supplied `options.ids` was actually an array. A string of matching length — `'abc'` alongside three vectors — passed the count check and was then sliced and indexed exactly like an array, silently writing each *character* as a vector key to AWS and returning the string itself as the caller's id list. No error was raised anywhere: wrong ids committed durably, with the usual `writtenIds` recovery path useless because the caller believed they had supplied their own ids. The `_validateIsArray` guards added in 0.6.0 covered six argument positions but missed this one in all three write methods. Not identified by the review; found while verifying it.

**Error-contract fixes:**

- The constructor threw a raw, uncoded `TypeError` for `client: null` — `null !== undefined` is `true`, so evaluation reached `null.config` before the intended fallback path could run — breaking the guarantee that every failure surfaces as a typed `S3VectorsError`.
- `similaritySearchVectorWithScore`'s missing-`distance` guard (added in 0.7.0) tested `=== undefined` only. An explicit `null` passed it and reached the relevance-score conversion, where `1.0 - null` coerces to `1.0` — the *best possible* score, and precisely the silent misranking 0.7.0 set out to close, reached through a different value. Now checked with `typeof` plus `Number.isFinite`, which also rejects `NaN` and `±Infinity`.
- `_getIndex`'s response-shape guard had the same `=== undefined` gap: a literal `null` index reached `index.dimension` and threw a `TypeError` that was caught and wrapped, but as `AWS_REQUEST_FAILED` carrying raw internal text (`Cannot read properties of null`) rather than the `AWS_INVALID_RESPONSE` diagnosis the same function already produces for every other malformed shape.
- `delete({ deleteAll: true })` against an already-deleted index surfaced a generic `AWS_REQUEST_FAILED` instead of behaving idempotently. Confirmed against real AWS that `DeleteIndex` on a missing index returns `NotFoundException` — the same shape `_getIndex` already special-cases. Because the cache clear (`_validatedIndexInfo = null`, `_indexEpoch++`) ran only on a *successful* delete, a stale cache from an earlier write on the same instance was also left unreconciled when the delete instead revealed the index was already gone; it now runs in both cases.

**Cancellation and cost:**

- `similaritySearchWithScore` validated only `k` before embedding, so an already-aborted signal still paid for a full, uncancellable, billable `embedQuery` call before failing — contradicting the README's documented pre-abort behaviour, and inconsistent with `addDocuments`, which has guarded its analogous `embedDocuments` call since 0.6.0. Filter validation had the same shape, running after the embed call even though it is exactly as cheap and synchronous as the `k` check deliberately hoisted above it. Both now run first, covering all three text-search entry points.
- `similaritySearchWithRelevanceScores` placed `signal` in the parameter slot every other text-based method reserves for `Callbacks`, so a caller following that house pattern — `(query, k, filter, undefined, signal)` — had cancellation silently dropped. The review attributed this to generic `VectorStore` callers; that mechanism does not hold, since `@langchain/core`'s `VectorStore` does not declare this method at all. The house-pattern inconsistency is the reproducible defect.

**Validation gaps:**

- Neither `similaritySearchVectorWithScore` nor `similaritySearchByVector` checked that the query vector was an array; a non-array reached AWS as a malformed `float32` payload. Now validated in `_queryVectors`, where both entry points converge.
- 0.7.0 extended the per-batch dimension check to every batch, but only for *within-batch* consistency — a later batch was still never checked against the actual index dimension, since only batch 0 goes through `_validateBeforeWrite`. A uniformly-wrong-dimension later batch therefore reached `PutVectors` and surfaced AWS's generic `ValidationException` instead of the coded `INDEX_CONFIG_MISMATCH` the identical mistake gets in batch 0. Batch 0 has already cached the index's dimension by then, so later batches are now checked for free.

**Data preservation:**

- `createDocument` deleted the `pageContentMetadataKey` entry unconditionally after reading it, so a *non-string* value under that key — reachable when something other than this library writes to the same index — vanished from the returned metadata entirely. The empty `pageContent` for that case is intentional and tested; losing the raw value with no flag was not. The key is now deleted only when its value was actually consumed as page content.

**Diagnostics and code quality:**

- The empty-batch validation message fired for a one-item batch containing a zero-dimensional vector — the only case that can actually reach it, since both write methods return early on empty input and `chunk()` never yields an empty batch. Reworded to name both possibilities without misattributing the cause.
- `getByIds` inferred "this batch has duplicate ids" from the response map being smaller than the request, which is also true when an id is simply missing — triggering a `structuredClone` on a result the missing-id throw discards anyway. Now compared against a `Set` of the requested ids. No behavioural change; the wasteful clone could never reach a caller.
- `_createIndex` declared an `AbortSignal` parameter no caller ever populated. Its only caller, `_ensureIndexExists`, deliberately never passes one — that GetIndex/CreateIndex work is shared across concurrent writers and no single caller may cancel it out from under the others — so the parameter implied a cancellability that does not exist and only ever forwarded a literal `undefined`.

### Notes on verification

Two findings cannot be reproduced against a correctly-functioning AWS endpoint, by nature rather than for lack of effort. The response-guard fixes (`distance`, `distanceMetric`, `_getIndex`) require a malformed response: AWS and Smithy omit absent optional fields rather than emitting a literal `null`, so only a mocked, stubbed, or non-conforming custom client can produce the triggering input — which is exactly the scenario the code's own error messages name. The page-limit fix would need more than 10,000 real indexed vectors under a filter selective enough to under-fill 100 consecutive pages. Both are covered by unit tests. What the live suite does confirm is the inverse: real `QueryVectors` responses always carry a finite numeric `distance` and a `distanceMetric` of `cosine`/`euclidean`, so the new guards do not misfire against the real service.

## [0.7.0] - 2026-08-28

### Added

- Documented that `QueryVectors` pagination doesn't preserve partial results on a mid-pagination failure, unlike every write/delete/get path in this library — a reasonable asymmetry (a failed search is side-effect-free and trivially retryable, unlike a failed write) that was previously undocumented.
- Unit test coverage for `delete({ deleteAll: true })` racing a write that has already passed local validation and is inside its actual `PutVectors` network call — previously only the race against this library's own local index-validation cache was covered (the existing "index-validation cache — concurrency" tests gate `GetIndexCommand`; the new ones gate `PutVectorsCommand` itself). A mocked client can't prove what AWS itself does with an orphaned `PutVectors` call, but the new tests prove this library's own state machine doesn't hang, crash, or resurrect a cleared cache under either a resolve-late or reject-late ordering.

### Fixed

- `similaritySearchVectorWithScore` defaulted a missing per-result `distance` to `0` — the *best possible* cosine relevance score — silently ranking a malformed result first instead of surfacing an anomaly, inconsistent with this same file's fail-closed handling of a missing `distanceMetric` (added in 0.5.0). This default dates back to 0.2.0; `returnDistance: true` is always requested, so a missing `distance` now throws a coded `AWS_INVALID_RESPONSE` error instead.
- The per-batch vector-dimension-consistency check — introduced in 0.4.0 with a documented "only the first batch is checked" limitation, then extended in 0.6.0 to check all of that first batch's vectors (not just `vectors[0]`) — still only ran on batch 0 of a multi-batch `addVectors` call. A caller-constructed batch 2+ with an internal dimension mismatch reached `PutVectors` unchecked, surfacing AWS's own less-specific validation error instead of this library's coded `INDEX_CONFIG_MISMATCH`. Now checked for every batch, closing the original 0.4.0 limitation for good.
- The constructor's `client` identity check used `Object.prototype.isPrototypeOf.call(S3VectorsClient.prototype, ...)` (added in 0.6.0), which shares `instanceof`'s weakness: a bundler duplicating `@aws-sdk/client-s3vectors` across a module boundary would make a legitimately-valid pre-configured client fail the check and get silently replaced with a freshly-built one. Now checks `config.client.config.serviceId === 'S3Vectors'` — a value baked into the client at construction, not tied to a specific copy of the class's prototype — while still accepting a subclassed client (e.g. a tracing wrapper) exactly as before.
- The README's "Concurrency" section claimed `delete({ deleteAll: true })` racing an in-progress write had been "verified to fail cleanly" (since 0.4.0) — that was never actually backed by a test, unit or live-AWS, only inferred from reading the code. Reworded to say precisely what's now true: unit tests cover the write once it's already past local validation and inside its actual `PutVectors` call, confirming this library's own state doesn't corrupt or hang under either ordering — live-AWS confirmation of this exact interleaving still doesn't exist.

## [0.6.0] - 2026-08-27

### Fixed

**Error-contract fixes** (every failure is supposed to surface as a coded `S3VectorsError` — these closed the cases where it didn't):

- `maxMarginalRelevanceSearch` was never implemented (only documented as unsupported), so a direct call threw a raw, uncoded `TypeError` instead of this library's own `S3VectorsError` — contradicting the guarantee that every failure is typed. Now explicitly defined; always rejects with a new coded error, `NOT_IMPLEMENTED`.
- `_getIndex` destructured `GetIndexCommand`'s response via a type-cast with no runtime check that `index`/`dimension`/`distanceMetric` were actually present (all three are independently optional per the AWS SDK's own types) — a response missing any of them threw a raw `TypeError` miscategorized as `AWS_REQUEST_FAILED`. Now throws a new coded error, `AWS_INVALID_RESPONSE`, with a clear diagnosis.
- `isError` (used internally to normalize a raw thrown value into an `Error`) missed `DOMException` and any other `Error` subtype that defines its own `Symbol.toStringTag` — it matched only the exact `Object.prototype.toString` tag `'[object Error]'`. A caller-supplied `embedDocuments` throwing a `DOMException` (e.g. from a native `fetch`/`AbortController`) had its real message replaced with `{}`. Now detects any value with string `name`/`message` properties, matching this repo's existing duck-typing convention (`isAbortError`, `isAwsNotFoundException`) instead of a tag check.
- `safeStringify` (used in the same error-normalization path) silently returned the literal value `undefined` — not a string — for a thrown `undefined`, function, or symbol, since `JSON.stringify` returns `undefined` rather than throwing for those inputs. A caller doing `throw undefined` produced an error message with the real cause silently dropped (`"<operation> failed: "` instead of `"<operation> failed: undefined"`).
- `createDocument`'s `structuredClone` call (used when `getByIds` detects duplicate ids in a batch) could throw an uncaught, uncoded exception for any non-structured-cloneable metadata value (e.g. a function, reachable via a custom client). Now caught and re-thrown as a coded `S3VectorsError`.
- Failures that never touched AWS — a raw throw from a caller-supplied `embeddings` model, or caller input malformed enough to bypass validation entirely (e.g. a non-array `documents` argument to `fromDocuments`) — were reported with the `AWS_REQUEST_FAILED` code, even though no AWS request was ever made. Added a new code, `S3VectorsErrorCode.UNEXPECTED_ERROR`, specifically for this case; `AWS_REQUEST_FAILED` is now reserved for an actual AWS S3 Vectors request failing.

**Validation gaps:**

- Only `vectors[0]` of a batch's write was dimension-checked against the index — a later vector in that *same* first batch with a mismatched dimension reached `PutVectors` unchecked, surfacing as a raw AWS `ValidationException` instead of the coded `INDEX_CONFIG_MISMATCH` every other dimension mismatch already produces. (Distinct from the existing, still-open "later batches aren't checked" limitation — this closes a gap *within* the one batch that was supposed to be fully checked.)
- `buildPutMetadata`/`createDocument` tested for the reserved `pageContentMetadataKey` with the `in` operator, which matches inherited `Object.prototype` properties (`constructor`, `toString`, etc.), not just a document's own metadata — configuring `pageContentMetadataKey: 'constructor'` made the store throw "reserved key" on every write regardless of actual metadata. Switched to `Object.hasOwn`.
- Creating an index with `nonFilterableMetadataKeys` already at or over AWS's 10-key cap *and* already including the page-content key threw "Cannot add pageContentMetadataKey" even though nothing was actually being added — the real (pre-existing, caller-side) problem was being misattributed to this library's auto-add step. Now only throws when the page-content key is genuinely new to the caller's list.
- The constructor's `client` validation only checked for a `.send` function, silently accepting any object shaped like an AWS SDK client (even the wrong service's client) as `this._client`, and silently discarding an invalid one with no diagnostic. Now checks the object's actual class identity (`Object.prototype.isPrototypeOf.call(S3VectorsClient.prototype, ...)` — `instanceof` is disallowed in this codebase, and calling `.isPrototypeOf(...)` directly is disallowed by `no-prototype-builtins` — this also correctly accepts a legitimate `S3VectorsClient` subclass, e.g. a tracing wrapper) and logs a `console.warn` when falling back.
- `_validateFilter`'s empty-filter guard skipped arrays entirely (forwarding `[]` straight to AWS instead of rejecting it locally) and mis-detected any non-plain-object filter (`Map`, `Set`, a class instance) as an empty object via `Object.keys().length === 0`. Now does a proper plain-object shape check first, with a distinct message for each rejected shape. Reachable by ordinary typed callers, not just untyped ones — `Record<string, unknown>` does not structurally exclude arrays or `Map`/`Set`.
- `addVectors`, `addDocuments`, `addTexts`, `delete({ ids })`, `getByIds`, and `fromTexts` never checked that their array-typed argument (`vectors`/`documents`/`texts`/`ids`) was actually an array before calling array methods on it — a non-array value (reachable from an untyped JS caller, or a cast past the type system) surfaced as a raw, uncoded `TypeError` instead of this library's own coded `S3VectorsError`, and for `addVectors` specifically, with no wrapping at all. All six now reject a non-array argument up front with a clear `VALIDATION` error. `addTexts`'s optional `metadatas` argument had the same gap for a truthy non-array value (previously either a raw `TypeError` deeper in, or a confusing "must match number of texts (undefined)" message) — now validated too, when provided.

**Data-consistency fixes** (partial-failure reporting was silently losing information):

- `getByIds` used `Promise.all` per concurrency group instead of the `Promise.allSettled` every sibling batched method (`delete`, `addDocuments`, `addVectors`) already uses — a single batch failure discarded all information about ids found in sibling batches that succeeded in the same group. `S3VectorsErrorContext` gained `foundIds`, populated the same way `writtenIds`/`deletedIds` already are.
- `fromDocuments`/`fromTexts` constructed their `AmazonS3Vectors` instance purely locally and discarded it on a partial-write failure — the thrown error's `context.writtenIds` named ids already durably written, but the caller had no store handle to act on them without manually reconstructing an equivalent instance. `S3VectorsErrorContext` gained `instance`, set on any error these two factories throw.

**Concurrency fixes:**

- `addDocuments` checked the abort signal before every batch group except the very first — an already-aborted signal still paid for one full, billable, uncancellable `embedDocuments` call on the first batch before the operation failed. Now checked before the first batch too.
- A concurrent `delete({ deleteAll: true })` could be silently undone by a write already in flight: the write's post-await cache assignment never re-checked for an intervening deletion, so it could overwrite the delete's cache clear with stale pre-delete index info. Added a generation counter (`_indexEpoch`), bumped on every `deleteAll`, that a write's cache commit now checks before writing.
- The shared in-flight promise memoizing concurrent index-creation attempts only threaded the *first* caller's `AbortSignal` into the underlying `GetIndex`/`CreateIndex` calls — that caller's abort cancelled every concurrent sibling's write too, even ones with no signal of their own. The shared calls are no longer tied to any single caller's signal; each caller now races its own wait against its own signal instead.

## [0.5.0] - 2026-08-26

### Added

- `AbortSignal` support on every method that calls AWS — `addVectors`, `addDocuments`, `addTexts`, `delete`, `getByIds`, all `similaritySearch*` methods, and the `fromTexts`/`fromDocuments` static factories. An aborted operation rejects with a new coded error, `S3VectorsErrorCode.ABORTED`, distinct from `AWS_REQUEST_FAILED`. Confirmed live: aborting mid-write cancels the AWS request actually in flight rather than waiting for it to finish, and a signal that's already aborted before the call starts rejects immediately with no network call. `embedDocuments`/`embedQuery` have no cancellation support in LangChain's `EmbeddingsInterface`, so a batch already being embedded when the signal fires still completes; `addDocuments` checks the signal before starting the next batch's embedding so it doesn't pay for that expensive, uncancellable call for a write nobody wants anymore.
- `addVectors` and `addDocuments` now dispatch `PutVectors` calls for batches after the first concurrently (up to 10 in flight at once, the same concurrency `delete()`/`getByIds()` already use), instead of awaiting each batch sequentially in a loop. `addDocuments` keeps `embedDocuments` strictly sequential across batches — never called concurrently for two batches, since most embedding providers rate-limit aggressively and this library gives no retry/backoff guarantee for that call — while still dispatching that batch's `PutVectors` call without waiting for it to finish before embedding the next one. Confirmed live with 2,500 documents, including correct id/pageContent/metadata pairing preserved across concurrent batches.
- Published sourcemaps (`dist/*.js.map`) now embed the original TypeScript source directly (`inlineSources: true`) instead of pointing at `../src/*.ts`, a path that doesn't exist in the published package (`files` in `package.json` only ships `dist`, `LICENSE`, `README.md`). Previously, stepping into this library's code in a debugger produced a dead link; source is now available without also having to ship `src/` in the package.
- Documented the exact metadata size limits confirmed live — 2048 bytes filterable per vector, 40,960 bytes total per vector (both KiB-exact, matching AWS's own error text) — along with why no client-side pre-flight check exists for them: probing shows the true byte count AWS measures isn't a simple `JSON.stringify(...).length` of the metadata object or of the value alone, and reproducing an unpublished algorithm risks rejecting metadata AWS would have accepted.

- CI hardening: `CodeQL` (`.github/workflows/codeql.yml`) runs static analysis on every push/PR to `main` plus a weekly schedule; `Dependency Review` (`.github/workflows/dependency-review.yml`) fails a PR that introduces a high-severity-or-worse vulnerable dependency; `OpenSSF Scorecard` (`.github/workflows/scorecard.yml`) publishes a security-practices score to the public Scorecard dataset weekly and on push to `main`. The release workflow now also generates a CycloneDX SBOM (via npm's own built-in `npm sbom`, no extra third-party action) for the exact package version being published and attaches it to the GitHub Release.
- **Partial-batch write/delete failures now report what already succeeded.** `S3VectorsErrorContext` gained `writtenIds`/`deletedIds`. If `addVectors`/`addDocuments` fails partway through a multi-batch write, the thrown error's `context.writtenIds` lists every id confirmed durably written before the failure — including a concurrent batch that succeeded alongside the one that failed (found by waiting out every sibling in a concurrency group via `Promise.allSettled` instead of racing ahead on the first rejection with `Promise.all`, which would otherwise lose a slower sibling's success). Previously this information was simply gone: with auto-generated ids specifically, a partial write left orphaned vectors in AWS with no way to discover, clean up, or reconcile them, ever. Confirmed live against real AWS with a genuinely AWS-rejected batch (wrong vector dimension). `delete({ ids })` reports the equivalent `context.deletedIds` on a partial failure.
- `addVectors`/`addDocuments` now use each document's own `id` as the vector's key when `options.ids` is omitted, falling back to a fresh UUID only for documents with no `id` of their own — enabling a natural `getByIds` → modify → `addDocuments` upsert round trip. This is a deliberate departure from the Python `langchain-aws` reference (verified: it never inspects `document.id`, only `options.ids` or a fresh UUID) — not a parity gap, since it doesn't change wire format or stored data shape, only which id gets used when the caller didn't specify one.

### Changed

- Writing to an index with `createIndexIfNotExist: true` (the default) now caches the index's dimension/metric for the store instance's lifetime after the first successful write, the same way `createIndexIfNotExist: false` already did. Previously only the `false` path cached this (`_validatedIndexInfo`); the default path's memoization (`_ensureIndexPromise`) only ever covered concurrent callers racing at the same instant, not sequential calls, so every single write on the default config paid for a `GetIndexCommand` round trip. Confirmed live: 5 sequential `addDocuments` calls dropped from 5 `GetIndexCommand` calls to 1. Fewer round trips also reduces AWS throttling probability on write-heavy workloads.
- The read-path distance-metric guard in `similaritySearchVectorWithScore`/`similaritySearchByVector` now fails closed instead of open: if a `QueryVectors` response is ever missing `distanceMetric`, the search now throws an `INDEX_CONFIG_MISMATCH` error instead of silently skipping the metric-mismatch check. Confirmed live across three response shapes (empty index, filtered to zero results, and a normal match) that `distanceMetric` is always present, so this closes a theoretical silent-wrong-relevance-score risk without a live-observed false-positive risk.
- `isS3VectorsError` is now a proper TypeScript type guard (`value is S3VectorsError`) instead of returning a plain `boolean`. Previously every TypeScript consumer had to cast (`e as S3VectorsError`) after a passing `isS3VectorsError(e)` check, since the compiler had no way to narrow `unknown` from a boolean-returning function.

### Fixed

- The `README.md` retriever example suggested `searchType: "similarity_score_threshold"` as a configurable option in a comment. That value isn't valid for `@langchain/core@1.2.9`'s `asRetriever()` (`"similarity" | "mmr"` are the only two), and the only real alternative, `"mmr"`, throws at call time in this store specifically (Maximal Marginal Relevance is intentionally not implemented). Replaced with an accurate note instead of a misleading example.
- The README's Node.js version badge said `>=22.14` — stale since the `engines.node` floor was lowered to `>=20` in a previous release; the "Runtime Requirements" section already had the correct value.

## [0.4.0] - 2026-08-26

### Changed

- **BREAKING:** `delete()` now requires either an `ids` array or `{ deleteAll: true }` — calling `delete()` (or `delete({})`) with neither now throws instead of deleting the entire index. Closes a footgun where an accidentally-`undefined` `ids` variable would silently wipe the whole index. Passing both `ids` and `deleteAll: true` together also now throws, instead of silently ignoring `deleteAll`.
- **BREAKING:** `@aws-sdk/client-s3vectors` and `@langchain/core` are now declared only as `peerDependencies` (previously also listed in `dependencies`, which could cause npm to install a second, version-mismatched copy of either package nested inside this package's own `node_modules` — e.g. a duplicate `@langchain/core` whose `Document` class has different identity from the consuming app's own `Document`). Install both alongside this package, as the README already documents.
- **BREAKING:** `credentials` in `AmazonS3VectorsConfig` is now typed as `S3VectorsClientConfig['credentials']` (`AwsCredentialIdentity | AwsCredentialIdentityProvider`, sourced from the peer-declared `@aws-sdk/client-s3vectors`) instead of `any`. A TypeScript consumer passing a value that isn't structurally one of those two shapes now gets a compile error. Previously sourced the type from `@smithy/types` directly, which isn't a declared dependency and could fail to resolve under strict package managers (pnpm's isolated layout, Yarn PnP).
- Lowered the `engines.node` floor from `>=22.14.0` to `>=20`. The `>=22.14.0` floor was mistakenly justified by an unrelated *publish-time* requirement (npm Trusted Publishing needs npm CLI ≥11.5.1, which ships with Node ≥24 — that only affects the release workflow, never the published package's runtime). Both peer dependencies already require only Node ≥20, and no code in this package uses a Node 22+-only API. CI now also tests against Node 20.
- CI (`ci.yml`) now also runs on pull requests targeting `main`, not just pushes to `main`.
- `k` must now be a positive integer for every similarity-search method — matches the existing `batchSize` guard's pattern, and for the string-query methods (`similaritySearch`, `similaritySearchWithScore`, `similaritySearchWithRelevanceScores`) is checked before the query is embedded, so an invalid `k` doesn't cost a billable embedding call.
- The constructor now validates `vectorBucketName` against AWS's own documented naming rules (3–63 characters; lowercase letters, numbers, and hyphens only) instead of only rejecting an empty string — a malformed bucket name now fails fast and locally instead of surfacing as an opaque AWS `ValidationException` on the first API call.
- CI workflows now pin every third-party GitHub Action to a specific commit SHA (with the release version as a trailing comment) instead of a floating major-version tag. Dependabot's existing `github-actions` update job keeps these current automatically. `aws-actions/configure-aws-credentials` is pinned to `v6.2.3` (was `v6.0.0`), picking up an account-ID-allowlist validation hardening fix from `v6.2.1` as defense-in-depth (this repo's own usage doesn't set `allowed-account-ids`, so it wasn't exploitable here either way).
- `euclideanRelevanceScoreFn`'s and the README's relevance-score documentation no longer claim a [0, 1] output range for the euclidean case. Confirmed against the live service: S3 Vectors' `euclidean` distance is *squared* L2, not linear L2, so dividing it by a linear scale (inherited from the Python `langchain-aws` reference for parity) doesn't reliably bound the result the way the cosine conversion does — for normalized embeddings the score lands in a narrow band near 1 rather than spanning [0, 1], and can go negative for unnormalized ones. The formula is unchanged (parity is intentional); only the documented range was wrong.

### Added

- Existing-index validation: writing to an already-created index whose `dimension` or `distanceMetric` doesn't match this store's configuration now throws a coded `S3VectorsError` (`INDEX_CONFIG_MISMATCH`) instead of failing later with an opaque AWS error (dimension mismatch) or silently computing relevance scores against the wrong metric. Each concurrent writer — including concurrent callers racing to create a brand-new index, and a caller that loses a cross-*process* creation race (whose winner's actual committed dimension/metric is now re-fetched and validated against, instead of being skipped) — is validated against its own vector rather than sharing one caller's verdict; a caller's own empty batch is likewise never attributed to a different, concurrently-racing caller. The check now also runs when `createIndexIfNotExist: false` — fetched once via `GetIndex` and cached for the store's lifetime (cleared on `delete({ deleteAll: true })`), so this doesn't reintroduce the per-write `GetIndex` round-trip that flag exists to avoid. Similarity-search reads validate the distance metric too (AWS returns it on every `QueryVectors` response), since a mismatch there would otherwise silently compute a relevance score with the wrong formula and no write-path check ever runs for a read-only consumer. **Known limitation:** only the first batch of a multi-batch write is checked — a later batch with a mismatched dimension still surfaces as a raw AWS error rather than the coded one.
- `similaritySearchVectorWithScore`/`similaritySearchByVector` now page through `QueryVectors`' `nextToken` until `k` results are collected or the result set is exhausted. Previously a single `QueryVectors` call was made regardless of `k`, so requesting `k` greater than AWS's ~100-result page cap silently returned fewer documents than requested. The pagination loop is bounded at 100 round trips — confirmed against the live service that its page size is fixed (not caller-tunable or content-dependent: `topK` of 101, 1,000, and 10,000 each return exactly 100 results per page), and `topK` itself caps at 10,000, so 100 pages is the most any legitimate search could ever need. It deliberately does *not* stop early on an empty-but-`nextToken`-bearing page, since a heavily-filtered query can return one legitimately with real results still on a later page.
- `addDocuments` now throws if the embeddings model returns a different number of vectors than documents passed in, instead of silently re-pairing embeddings with the wrong documents/ids by index. `addVectors` already guarded this exact invariant for caller-supplied vectors; this is the same guard for the embeddings-model-supplied case (e.g. a provider that silently drops empty-string inputs).
- Creating an index now throws instead of silently creating one with page content missing from `nonFilterableMetadataKeys`, when the caller's own `nonFilterableMetadataKeys` is already at AWS's 10-key cap. Previously this fell back to the caller's list unchanged, which made page content *filterable* metadata (capped at 2 KB per vector) instead of non-filterable (40 KB) — with no way to fix it afterward, since S3 Vectors has no way to reconfigure an existing index's metadata configuration. The error message names the fix (trim the list, or set `pageContentMetadataKey: null`).
- `SECURITY.md` — vulnerability disclosure process.
- `CONTRIBUTING.md` — local development, coding standards, and PR expectations (expanded from the README's former inline "Contributing" section).
- `addVectors`/`addDocuments` now validate a mismatched `ids` array length *before* the empty-input short-circuit, instead of after it. Previously `addVectors([], [], { ids: ['a', 'b'] })` (and the `addDocuments` equivalent) silently returned `[]`, swallowing what a non-empty batch would have correctly rejected as a caller mistake.
- `batchSize` is now validated against AWS's actual per-call ceiling for each operation (`addVectors`/`addDocuments`: 500, matching `PutVectors`; `delete`: 500, matching `DeleteVectors`; `getByIds`: 100, matching `GetVectors`), confirmed live against the real service. `k` is likewise validated against AWS's `topK` ceiling of 10,000. Both previously relied on AWS's own validation error, several round trips away from local, `batchSize`/`k`-must-be-a-positive-integer-style validation.
- Documented S3 Vectors' actual accepted metadata value types (strings, numbers, booleans, and homogeneous arrays of strings/numbers) in the README, along with two silent-coercion behaviors confirmed live and worth knowing about: a `Date` value round-trips as a plain number (Unix epoch **seconds**, not milliseconds), and `NaN` round-trips as the string `"NaN"` — neither errors, both quietly change the value's type. `null` and nested objects are rejected outright by AWS.
- A new live integration test (`bugfix-verification.test.ts`) covers two genuinely separate `AmazonS3Vectors` instances racing to create the same new index — confirmed against real AWS that the losing instance's `ConflictException` is recovered from correctly. The existing same-instance race test only ever exercises this store's in-process memoization (`_ensureIndexPromise`), since a single instance only ever issues one `CreateIndex` call; this is the one that actually exercises the cross-process recovery path live.
- `similaritySearch`/`similaritySearchVectorWithScore`/etc. now reject an empty filter object (`{}`) locally instead of forwarding it to AWS, which rejects it with an opaque "Invalid filter" error rather than treating it as "no filter" (confirmed live). Omit the `filter` argument (or pass `undefined`) to search without filtering.
- Confirmed live with 5 concurrent, entirely separate `AmazonS3Vectors` instances racing to create the same new index (not just 2) — all succeed, with the `ConflictException` recovery path holding up beyond the smallest possible race. Added as a permanent live integration test.
- Documented (README, "Metadata Filtering" and new "Concurrency" sections) three more behaviors confirmed live: a type-mismatched filter comparison silently returns zero results rather than erroring; filtering on a non-filterable metadata key fails with a clear AWS error; and `delete({ deleteAll: true })` racing an in-progress write causes that write's remaining batches to fail with a plain "index not found" error rather than being coordinated — verified to fail cleanly, with no data corruption or hang, but not specially handled.

## [0.3.2] - 2026-08-26

### Changed

- Upgraded all dependencies to their current versions, including `@aws-sdk/client-s3vectors` (`^3.1117.0`), `@langchain/core` (`^1.2.9`), and the full devDependency set.
- `typescript` now resolves via the `@typescript/typescript6` compatibility package, since TypeScript 7's native Go compiler doesn't yet expose a stable API and `ts-jest`, `typescript-eslint`, and `typedoc` all still depend on the JS-based one. A separate `@typescript/native` devDependency tracks real TypeScript 7 for future adoption once tooling support catches up.
- Migrated the `cpd:full`/`cpd:test` scripts to jscpd v5's CLI: the `full` reporter is now `console-full`, and the removed `--verbose` flag was dropped.
- Bumped `actions/checkout` and `actions/setup-node` to v7 across all GitHub Actions workflows.
- The default page-content metadata key (`_page_content`) is now automatically added to `nonFilterableMetadataKeys` when this library creates a new index (unless `pageContentMetadataKey` is `null`, or the key is already listed). Filterable metadata is capped at 2 KB per vector by S3 Vectors; document text stored as ordinary filterable metadata could exceed that cap. This only affects indexes created by this library going forward — existing indexes are unaffected, since non-filterable keys can't be changed after index creation.
- `similaritySearch()` (and therefore `asRetriever()`) now embed queries using the configured `queryEmbeddings` model when one is set, instead of always using the indexing embedding model.
- `addDocuments`/`addTexts`/`fromTexts`/`fromDocuments` now throw a coded `S3VectorsError` (`EMBEDDINGS_MISSING`) instead of a plain `Error` when no embedding model is configured.
- `fromDocuments`/`fromTexts` now forward a `batchSize` option through to the underlying `addDocuments` call.
- `fromTexts` now validates that a `metadatas` array's length matches the `texts` array's length (previously silently truncated or padded with `{}`), matching `addTexts`'s existing behavior.
- Document metadata that already uses the reserved `pageContentMetadataKey` (default `_page_content`) now throws instead of being silently overwritten.
- `batchSize: 0` or a negative `batchSize` now throws instead of looping forever.
- Concurrent `addVectors`/`addDocuments` calls against a not-yet-existing index no longer race on `CreateIndex`.
- `delete`/`getByIds` now issue their batch AWS calls with bounded concurrency (up to 10 in flight at once) instead of strictly sequential — faster for large ID lists without risking AWS's per-index request-rate limits.
- `batchSize` must now be a positive **integer** (not just non-negative) for `addVectors`/`addDocuments`/`delete`/`getByIds` — a non-integer value like `1.5` now throws the same `batchSize must be a positive integer` error.
- `_createIndex` no longer sends an empty `metadataConfiguration.nonFilterableMetadataKeys` array to `CreateIndex` (previously sent for an explicitly-passed empty array); it's omitted entirely when there's nothing to configure. The auto-added default page-content key is also skipped (falling back to exactly what was configured) if adding it would exceed S3 Vectors' 10-key non-filterable-metadata-key cap.

### Added

- `similaritySearchWithRelevanceScores(query, k?, filter?)` — applies `relevanceScoreFn` (or the built-in cosine/euclidean converter) to search results, previously configurable but unused by any method.

## [0.3.1] - 2026-05-31

### Added

- Typed `S3VectorsError` carrying a `code` (`S3VectorsErrorCode`) and a `context` (`{ operation, vectorBucketName, indexName }`), plus the `isS3VectorsError` guard — all exported from the package root.
- `maxAttempts` and `retryMode` config options, forwarded to the AWS SDK retry strategy (throttling/5xx retries are handled by the SDK).
- Early validation of `vectorBucketName` and `indexName` in the constructor (fails fast before any AWS call).
- 100% statement/branch/function/line coverage, enforced by the Jest threshold in CI.
- VectorStore contract tests (including `asRetriever()`), property-based tests (`fast-check`), a packaged-tarball smoke test, and compile-time public-API type tests.
- Standalone real-AWS verification scripts under `examples/` (real Amazon Bedrock Titan Text Embeddings V2), and a nightly scheduled live-AWS smoke workflow via GitHub OIDC.

### Changed

- All failures — validation, not-found, missing-embeddings, and underlying AWS request errors — are now surfaced as `S3VectorsError`. Error messages are unchanged.

### Removed

- Stryker mutation-testing scaffold (`stryker.conf.json`, `test:mutate` / `test:mutate:quick` scripts, and the `@stryker-mutator/*` devDependencies).

## [0.2.2] - 2026-05-26

A maintenance release: dependency updates and the audit fixes they carried,
with no change to the public API or to what is stored. Reconstructed from the
tags and the npm registry while validating this file — 0.2.1 was tagged but
never published, and 0.2.2 shipped without an entry here.

### Changed

- Dependencies updated across the tree, including the fixes `npm audit` flagged.
- CI: `aws-actions/configure-aws-credentials` bumped from 5 to 6 (Dependabot).

## [0.2.0] - 2026-04-18

### Added

- Integration test infrastructure (`jest.integration.config.cjs`, `test/integration/`) with env-gated live-AWS runs (`RUN_LIVE_INTEGRATION=1`, `AWS_VECTOR_BUCKET`). LocalStack does not support the `s3vectors` service ([localstack/localstack#13498](https://github.com/localstack/localstack/issues/13498)), so integration coverage runs against a real AWS vector bucket.
- On-demand live-AWS CI workflow `.github/workflows/integration-live.yml` using GitHub OIDC to assume an IAM role (`AWS_ROLE_TO_ASSUME`).
- Stryker mutation testing scaffold (`stryker.conf.json`, `test:mutate`, `test:mutate:quick`). Note: a known ESM+jest+Stryker interaction currently prevents test discovery inside Stryker's sandbox; the scaffold is in place for when that resolves.
- CI workflow `.github/workflows/ci.yml` on push to main: matrix of 3 OS (Ubuntu/Windows/macOS) × Node 22/24 with lint, typecheck, test, build, and `npm audit` jobs. CI does not run on pull requests.
- npm publishing with provenance attestations via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) — no long-lived `NPM_TOKEN`, automatic provenance.
- `aws-sdk-client-mock` as the unit-test mocking library (AWS-recommended for SDK v3). 5 new tests cover previously-uncovered error branches.
- Repo hygiene: `CODE_OF_CONDUCT.md` (Contributor Covenant), `CHANGELOG.md`, `.nvmrc`, `.gitattributes`, `.depcheckrc`, `.prettierignore`.
- `src/shared/` module with extracted internal helpers (`stub-embeddings`, `errors`, `metadata`).

### Changed

- **BREAKING:** Node engines raised from `>=20` to `>=22.14.0`. Node 22.14 is the minimum required by npm Trusted Publishing.
- **BREAKING:** `npm >=10.0.0` is now declared in `engines`.
- Upgraded TypeScript 5.9 → 6.0 with stricter tsconfig (retains `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`; explicit `types: ['node']` as required by TS 6).
- Upgraded `typedoc` 0.28.17 → 0.28.19 (TS 6 support, resolves transitive `handlebars` critical CVE).
- Upgraded `ts-jest` 29.4.6 → 29.4.9 (TS 6 support).
- Converted `eslint.config.js` to `eslint.config.ts` loaded via `jiti`.
- Renamed test directory `tests/` → `test/`; split the monolithic test file into 10 feature-scoped files.
- Raised unit-test coverage thresholds from 75/80/80 to 80/80/80/80. Current coverage: 96% statements, 84.76% branches, 91.89% functions, 97.03% lines.
- Decomposed `src/s3-vectors.ts` (629 → 478 lines): extracted internal helpers to `src/shared/` and renamed `src/utils.ts` → `src/relevance-scores.ts`. **Public API unchanged.**
- Converted Jest config files from TypeScript to CommonJS (`jest.config.cjs`, `jest.integration.config.cjs`) to remove the `ts-node` dependency.

### Removed

- Hand-rolled `{ send: jest.fn() }` mock helper, replaced by `aws-sdk-client-mock`'s typed `mockClient()` API.
- `ts-node` devDependency (no longer needed after Jest config conversion to CJS).
- `globals` devDependency (was unused).

### Fixed

- None (Phase 3 refactor is no-behavior-change; all new tests pass on the existing implementation).

## [0.1.0] - 2026-03-22

- Initial release.

[Unreleased]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.9.0...v1.0.0-rc.1
[0.9.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.2.2...v0.3.1
[0.2.2]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.2.0...v0.2.2
[0.2.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/FarukAda/aws-langchain-s3-vector-ts/releases/tag/v0.1.0
