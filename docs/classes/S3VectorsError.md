[**AWS LangChain S3 Vector TypeScript v0.6.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:54](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L54)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:59](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L59)

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

Defined in: [shared/errors/s3-vectors-error.ts:55](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L55)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:56](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L56)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:57](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ae64db953ac2f502ec56f3fecad85fab19cec663/src/shared/errors/s3-vectors-error.ts#L57)
