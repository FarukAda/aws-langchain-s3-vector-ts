[**AWS LangChain S3 Vector TypeScript v0.8.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:66](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/b9d26bbfef7d1216452ffe371cee65e0fa1e1291/src/shared/errors/s3-vectors-error.ts#L66)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:71](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/b9d26bbfef7d1216452ffe371cee65e0fa1e1291/src/shared/errors/s3-vectors-error.ts#L71)

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

Defined in: [shared/errors/s3-vectors-error.ts:67](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/b9d26bbfef7d1216452ffe371cee65e0fa1e1291/src/shared/errors/s3-vectors-error.ts#L67)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:68](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/b9d26bbfef7d1216452ffe371cee65e0fa1e1291/src/shared/errors/s3-vectors-error.ts#L68)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:69](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/b9d26bbfef7d1216452ffe371cee65e0fa1e1291/src/shared/errors/s3-vectors-error.ts#L69)
