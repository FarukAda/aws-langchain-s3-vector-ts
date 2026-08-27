[**AWS LangChain S3 Vector TypeScript v0.5.0**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:2](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L2)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### ABORTED

> **ABORTED**: `"ABORTED"`

Defined in: [shared/errors/error-code.ts:14](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L14)

The caller-supplied `AbortSignal` fired before or during the operation.

***

### AWS\_INVALID\_RESPONSE

> **AWS\_INVALID\_RESPONSE**: `"AWS_INVALID_RESPONSE"`

Defined in: [shared/errors/error-code.ts:16](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L16)

An AWS response was missing fields this library requires to proceed.

***

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:10](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L10)

An underlying AWS S3 Vectors request failed.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L8)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:12](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L12)

An existing index's dimension or distance metric doesn't match this store's configuration.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [shared/errors/error-code.ts:6](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L6)

A requested vector id or index was not found.

***

### NOT\_IMPLEMENTED

> **NOT\_IMPLEMENTED**: `"NOT_IMPLEMENTED"`

Defined in: [shared/errors/error-code.ts:18](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L18)

The requested operation is not implemented by this vector store.

***

### UNEXPECTED\_ERROR

> **UNEXPECTED\_ERROR**: `"UNEXPECTED_ERROR"`

Defined in: [shared/errors/error-code.ts:26](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L26)

A failure that didn't come from an AWS request — a raw throw from
caller-supplied code (e.g. an embeddings model) or caller input that
bypassed validation (e.g. a malformed argument to a static factory).
Distinct from `AWS_REQUEST_FAILED`, which is reserved for an actual
AWS S3 Vectors request failing.

***

### VALIDATION

> **VALIDATION**: `"VALIDATION"`

Defined in: [shared/errors/error-code.ts:4](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/c22b51a4a07d5939e84f0face7f07fe5247630c6/src/shared/errors/error-code.ts#L4)

Caller-supplied arguments were invalid (counts, names, empty batch).
