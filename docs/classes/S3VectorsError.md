[**AWS LangChain S3 Vector TypeScript v0.9.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:112](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/shared/errors/s3-vectors-error.ts#L112)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:117](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/shared/errors/s3-vectors-error.ts#L117)

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

Defined in: [shared/errors/s3-vectors-error.ts:113](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/shared/errors/s3-vectors-error.ts#L113)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:114](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/shared/errors/s3-vectors-error.ts#L114)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:115](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/fbffb20a139d0342888796a6ecb28d73aa65ad5a/src/shared/errors/s3-vectors-error.ts#L115)
