[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3OutputVector

# Interface: S3OutputVector

Defined in: [types.ts:234](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L234)

Shape of a single vector as returned by QueryVectors / GetVectors.

Public because it is the shape the store reads: a caller mapping their own
`QueryVectors` or `GetVectors` responses (for example from a Lambda that
calls the SDK directly) can type them against the same contract this store
maps to `Document`.

## Properties

### data?

> `readonly` `optional` **data?**: `object`

Defined in: [types.ts:253](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L253)

The embedding, present only when the request asked for data. Absent from
every search result: `QueryVectors` does not return vector data at all,
which is why MMR needs a second call.

#### float32?

> `optional` **float32?**: `number`[]

***

### distance?

> `readonly` `optional` **distance?**: `number`

Defined in: [types.ts:247](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L247)

The distance from the query vector, present only on a `QueryVectors`
result that asked for it. Lower is more similar, for both metrics.

***

### key

> `readonly` **key**: `string`

Defined in: [types.ts:236](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L236)

The vector key — the id this package wrote it under.

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:242](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L242)

The stored metadata, present when the request asked for it. Page content
is in here, under the store's `pageContentMetadataKey`, until
`createDocument` lifts it out.
