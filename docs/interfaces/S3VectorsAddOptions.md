[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsAddOptions

# Interface: S3VectorsAddOptions

Defined in: [types.ts:354](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L354)

Options accepted by [AmazonS3Vectors.addVectors](../classes/AmazonS3Vectors.md#addvectors) and
[AmazonS3Vectors.addDocuments](../classes/AmazonS3Vectors.md#adddocuments).

Named and exported rather than written inline at each signature, because a
caller wrapping either method needs to name the type — without one, the only
way to say it was `Parameters<AmazonS3Vectors['addDocuments']>[1]`, which is
what this package's own retriever had to publish in its declarations.

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: [types.ts:368](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L368)

Records per `PutVectors` request, 1–500.

#### Default Value

`200`

***

### ids?

> `readonly` `optional` **ids?**: `string`[]

Defined in: [types.ts:363](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L363)

An id per document, in the same order.

Omitted, each document's own `id` is used where it has one and a UUID is
minted where it does not. Supplying them is how a re-run overwrites in
place instead of writing a second copy under a fresh id — which is also
what `error.context.attemptedIds` is for after a partial failure.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:370](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L370)

Cancels the write. Batches already written stay written; see `error.context.writtenIds`.
