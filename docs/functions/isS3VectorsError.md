[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / isS3VectorsError

# Function: isS3VectorsError()

> **isS3VectorsError**(`value`): `value is S3VectorsError`

Defined in: [shared/errors/s3-vectors-error.ts:202](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/shared/errors/s3-vectors-error.ts#L202)

Whether `value` is one of this library's errors.

Accepts: anything, including a non-object.

Returns: `true` when the value carries this package's registered-symbol
brand. Deliberately not `instanceof`: that is false across realms (a `vm`
context, a worker) and false between the ESM and CommonJS copies of this
module, which a process mixing `import` and `require` will load both of.

Throws: nothing.

Guarantees: this is the supported way to recognise these errors, and the
brand string is stable for `1.x`.

## Parameters

### value

`unknown`

## Returns

`value is S3VectorsError`
