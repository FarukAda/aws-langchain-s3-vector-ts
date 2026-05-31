[**AWS LangChain S3 Vector TypeScript v0.3.1**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:17](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/shared/errors/s3-vectors-error.ts#L17)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:22](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/shared/errors/s3-vectors-error.ts#L22)

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

Defined in: [shared/errors/s3-vectors-error.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/shared/errors/s3-vectors-error.ts#L18)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:19](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/shared/errors/s3-vectors-error.ts#L19)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:20](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/cda64cc6c6d517c6d9bca630a227b58c5e7cb2a8/src/shared/errors/s3-vectors-error.ts#L20)
