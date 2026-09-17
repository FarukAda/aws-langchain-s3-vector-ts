[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / flattenMetadata

# Function: flattenMetadata()

> **flattenMetadata**(`metadata`): `Record`\<`string`, `unknown`\>

Defined in: [shared/flatten-metadata.ts:61](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/flatten-metadata.ts#L61)

Flatten nested document metadata into the shape S3 Vectors stores.

Accepts: a document's `metadata`, however deeply nested.

Returns: a new object whose nested plain objects have become dotted keys —
`{ loc: { lines: { from: 1 } } }` becomes `{ 'loc.lines.from': 1 }` — with
`null`, `undefined`, empty arrays and empty objects dropped, and every other
value passed through untouched. The caller's object and everything inside it
are left alone.

Throws: [S3VectorsError](../classes/S3VectorsError.md) with code `VALIDATION` when two fields would
flatten onto the same key, when the metadata contains a circular reference,
or when it is not an object at all.

Guarantees, and the reasons for them:
- **Nothing is converted.** A value this cannot flatten — a `Date`, a mixed
  array, a non-finite number — is passed through as it is, so the write path
  refuses it naming the document and the key rather than this quietly storing
  something the caller did not choose.
- **Only the empty is dropped.** `null`, `undefined`, `[]` and `{}` are what
  a loader emits for a field it has no value for, and S3 Vectors stores none
  of them; every one of those four is refused by the service, measured under
  a filterable *and* a non-filterable key
  (`docs/evidence/metadata-value-types.md`). Dropping them is what makes an
  ordinary loader document writable; anything else would be losing data.
- **A collision is refused, not resolved.** `{ 'loc.pageNumber': 1, loc: {
  pageNumber: 2 } }` has one answer at AWS and two here; picking one silently
  is how a document gets stored with a field nobody wrote.

Why this is a function you call rather than a store option: what a store
writes is what you passed it, and a flag that rewrote every document's keys
on the way to AWS would make that untrue for every write it touched. Here the
rewriting is visible at the call site.

## Parameters

### metadata

`Record`\<`string`, `unknown`\>

## Returns

`Record`\<`string`, `unknown`\>

## Example

```ts
import { flattenMetadata } from "@farukada/aws-langchain-s3-vector-ts";

const chunks = await splitter.splitDocuments(docs);
await store.addDocuments(
  chunks.map((doc) => new Document({ ...doc, metadata: flattenMetadata(doc.metadata) })),
);
```
