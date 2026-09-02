# Stability and compatibility policy (1.x)

This package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). For a vector store, what it writes to Amazon S3 Vectors is as much a contract as the TypeScript API, so this document states exactly what a `1.x` release promises to keep, what a minor may add, and what only a `2.0` may change.

## 1. The public API

The public API is everything exported from the package entry point (`src/index.ts`, published as `dist/esm/index.js` and `dist/cjs/index.js` with matching declarations): the `AmazonS3Vectors` class; the error model (`S3VectorsError`, `S3VectorsErrorCode`, `isS3VectorsError`, `S3VectorsErrorContext`); the relevance helpers (`cosineRelevanceScoreFn`, `euclideanRelevanceScoreFn`); and the types `AmazonS3VectorsConfig`, `DistanceMetric`, `VectorDataType`, `S3VectorsDeleteParams` and `S3OutputVector`. Tests pin the export set (`test/index-exports.test.ts`), the method signatures (`test/types/public-api.test-d.ts`) and the package manifest (`test/package-exports.test.ts`).

- A **minor** release may add exports, add optional options and parameters, add optional fields to returned objects and to `S3VectorsErrorContext`, and widen accepted inputs.
- A **patch** release changes behaviour only to fix a defect against the documented behaviour.
- Removing or renaming an export, making an option required, narrowing an input, changing a return type or changing a default requires a **major** release, preceded by a deprecation (section 5).
- Deep imports (`@farukada/aws-langchain-s3-vector-ts/dist/...`) are blocked by the `exports` map and are not part of the API; `./package.json` is exported for tooling. Members tagged `@internal` are stripped from the shipped declarations and are not supported.
- Both module formats are part of the API: `import` resolves to the ESM build and `require` to the CommonJS build on every supported Node version, each with its own declarations.

## 2. What the store writes to S3 Vectors

Every `1.x` release reads every vector a `1.0` release wrote, and writes vectors a `1.0` release can read. The layout below changes only in a major release, with a migration note.

| Field of a stored vector | Content |
| --- | --- |
| `key` | The document id: `Document.id` or the matching `ids` entry the caller passed, otherwise a generated 32-character hexadecimal UUID. Ids must be unique, non-empty strings within a call. |
| `data.float32` | The embedding, produced by the configured `embeddings` model (`addDocuments`, `addTexts`, the static factories) or supplied by the caller (`addVectors`). |
| `metadata` | The document's own metadata, plus the page content stored as a string under the reserved key named by `pageContentMetadataKey` (default `_page_content`; `null` disables the round-trip, and no page content is stored). A document whose metadata already uses the reserved key is rejected with `VALIDATION` rather than overwritten. |

On read (`similaritySearch*`, `getByIds`), the reserved key is lifted back out into `Document.pageContent` and removed from `metadata`. A non-string value under that key, which this library never writes, is left in `metadata` untouched and `pageContent` is empty.

Index configuration is fixed at creation and is not part of a stored vector. `dimension` (inferred from the first vector written), `distanceMetric`, `dataType`, `nonFilterableMetadataKeys`, `encryptionConfiguration` and `tags` are sent with `CreateIndex` when the store creates an index, and `dimension` and `distanceMetric` are validated against an existing index on the first write of every instance. A minor release may add optional index-creation fields; it will not change what an existing option sends.

`delete({ deleteAll: true })` deletes the *index* (`DeleteIndex`), matching the Python `langchain-aws` reference. That is documented behaviour and stable for `1.x`.

## 3. Errors

`S3VectorsErrorCode` values are append-only in `1.x`: a value is never removed or renamed, and a code is never reassigned to a different condition. `S3VectorsErrorContext` only gains fields; `operation` is always present. Error *messages* are not covered: branch on `code`, on `context` and on `cause`, never on text.

`isS3VectorsError` is the supported way to recognise this library's errors. It checks a brand, `Symbol.for('@farukada/aws-langchain-s3-vector-ts:S3VectorsError')`, rather than `instanceof`, so it works across realms and across the ESM and CommonJS copies of the module. The brand string is stable for `1.x`.

## 4. Supported runtimes and peers

| Dependency | Supported | Verified by |
| --- | --- | --- |
| Node.js | 22 and 24 | the unit tier on Linux, macOS and Windows, on every push |
| Module format | ESM (`import`) and CommonJS (`require`) | publint and arethetypeswrong over the packed tarball, and the package smoke that installs the tarball and uses it from both |
| TypeScript (consumers) | 5.x and later | the package smoke type-checks an ESM and a CommonJS consumer against the shipped declarations with TypeScript 5 and `skipLibCheck` off |
| `@aws-sdk/client-s3vectors` | `^3.1117.0` | the peer-floors CI job at the floor, the unit tier at the lockfile version, and the nightly live-AWS suite against the real service |
| `@langchain/core` | `^1.2.9` | the peer-floors CI job at the floor and the `VectorStore` contract suite |

Raising a floor (dropping a Node major after its end of life, requiring a newer peer minor) is a **minor** release and is announced in the CHANGELOG. A peer range is never narrowed in a patch.

## 5. Deprecation

Anything scheduled for removal is marked `@deprecated` in its JSDoc and listed in the CHANGELOG for at least one minor release before the major that removes it. Deprecated members keep working until then.

## 6. Deliberate divergences and non-goals

The behaviours below are choices, not defects. Each is documented in the README where it applies and is stable for `1.x`.

- `getByIds` throws `NOT_FOUND` for a missing id, as the Python reference does, where LangChain core's contract merely permits returning fewer documents. `context.foundIds` lists what was found before the failure.
- Maximal Marginal Relevance is not implemented; `asRetriever({ searchType: 'mmr' })` throws `NOT_IMPLEMENTED`.
- No `ListVectors`, bucket lifecycle, retry layer or client-side metadata-size enforcement (README, *Non-goals*).

## 7. Not covered

The wording of error messages, the order of results at equal distance, timing characteristics, the layout of the generated API reference under `docs/`, and the internal module structure.
