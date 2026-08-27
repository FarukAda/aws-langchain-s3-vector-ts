[**AWS LangChain S3 Vector TypeScript v0.5.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsError

# Class: S3VectorsError

Defined in: [shared/errors/s3-vectors-error.ts:49](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ce9620a2a056ed1c0d40b92400f84e5ee71bc332/src/shared/errors/s3-vectors-error.ts#L49)

The single error type surfaced by this library. Wraps validation failures,
not-found conditions, and underlying AWS errors behind one consistent shape.

## Extends

- `Error`

## Constructors

### Constructor

> **new S3VectorsError**(`message`, `code`, `context`, `cause?`): `S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:54](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ce9620a2a056ed1c0d40b92400f84e5ee71bc332/src/shared/errors/s3-vectors-error.ts#L54)

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

Defined in: [shared/errors/s3-vectors-error.ts:50](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ce9620a2a056ed1c0d40b92400f84e5ee71bc332/src/shared/errors/s3-vectors-error.ts#L50)

***

### code

> `readonly` **code**: [`S3VectorsErrorCode`](../enumerations/S3VectorsErrorCode.md)

Defined in: [shared/errors/s3-vectors-error.ts:51](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ce9620a2a056ed1c0d40b92400f84e5ee71bc332/src/shared/errors/s3-vectors-error.ts#L51)

***

### context

> `readonly` **context**: [`S3VectorsErrorContext`](../interfaces/S3VectorsErrorContext.md)

Defined in: [shared/errors/s3-vectors-error.ts:52](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/ce9620a2a056ed1c0d40b92400f84e5ee71bc332/src/shared/errors/s3-vectors-error.ts#L52)
