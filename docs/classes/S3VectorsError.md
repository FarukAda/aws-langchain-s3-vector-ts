[**AWS LangChain S3 Vector TypeScript v0.4.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:26](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L26)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:31](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L31)

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

Defined in: [shared/errors/s3-vectors-error.ts:27](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L27)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:28](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L28)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:29](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/8129a816b678ebc0de5d7ebd34811a58f0fe892b/src/shared/errors/s3-vectors-error.ts#L29)
