[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:135](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L135)

The single error type this library surfaces.

Accepts: a message, a [S3VectorsErrorCode](../enumerations/S3VectorsErrorCode.md), a context naming the
operation and the index, and optionally the underlying `cause`.

Returns: an `Error` subclass whose `name` is always `'S3VectorsError'`, with
`code`, `context` and `cause` readonly once set — which is why every
decorator rebuilds rather than mutates.

Throws: nothing.

Guarantees: instances carry a `Symbol.for` brand, so [isS3VectorsError](../functions/isS3VectorsError.md)
recognises them across realms and across the ESM and CommonJS copies of this
module. `cause` is always an `Error` when present: a caller can read
`error.cause.message` without checking what was actually thrown.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:140](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L140)

#### Parameters

##### message

`string`

##### code

[`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

##### context

[`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

##### cause?

`unknown`

#### Returns

`S3VectorsError`

#### Overrides

`Error.constructor`

## Properties

### \[S3\_VECTORS\_ERROR\_BRAND\]

> `readonly` **\[S3\_VECTORS\_ERROR\_BRAND\]**: `true` = `true`

Defined in: [shared/errors/s3-vectors-error.ts:136](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L136)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:137](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L137)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:138](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L138)
