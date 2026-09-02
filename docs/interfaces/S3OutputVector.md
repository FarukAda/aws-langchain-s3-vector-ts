[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3OutputVector

# Interface: S3OutputVector

Defined in: [types.ts:185](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L185)

Shape of a single vector as returned by QueryVectors / GetVectors.

Public: this is the input type of the exported `createDocument` helper,
so a caller mapping their own `QueryVectors` responses (for example from
a Lambda that calls the SDK directly) can build the same `Document`
shape this store produces.

## Properties

### data?

> `readonly` `optional` **data?**: `object`

Defined in: [types.ts:189](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L189)

#### float32?

> `optional` **float32?**: `number`[]

***

### distance?

> `readonly` `optional` **distance?**: `number`

Defined in: [types.ts:188](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L188)

***

### key

> `readonly` **key**: `string`

Defined in: [types.ts:186](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L186)

***

### metadata?

> `readonly` `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:187](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L187)
