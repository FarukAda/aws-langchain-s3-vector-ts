[**AWS LangChain S3 Vector TypeScript v0.3.2**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsErrorCode

# Enumeration: S3VectorsErrorCode

Defined in: [shared/errors/error-code.ts:2](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L2)

Stable error codes surfaced by [S3VectorsError](../classes/S3VectorsError.md).

## Enumeration Members

### AWS\_REQUEST\_FAILED

> **AWS\_REQUEST\_FAILED**: `"AWS_REQUEST_FAILED"`

Defined in: [shared/errors/error-code.ts:10](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L10)

An underlying AWS S3 Vectors request failed.

***

### EMBEDDINGS\_MISSING

> **EMBEDDINGS\_MISSING**: `"EMBEDDINGS_MISSING"`

Defined in: [shared/errors/error-code.ts:8](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L8)

An operation needed an embedding model but none was configured.

***

### INDEX\_CONFIG\_MISMATCH

> **INDEX\_CONFIG\_MISMATCH**: `"INDEX_CONFIG_MISMATCH"`

Defined in: [shared/errors/error-code.ts:12](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L12)

An existing index's dimension or distance metric doesn't match this store's configuration.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [shared/errors/error-code.ts:6](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L6)

A requested vector id or index was not found.

***

### VALIDATION

> **VALIDATION**: `"VALIDATION"`

Defined in: [shared/errors/error-code.ts:4](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/9449115ff5478ee799326d6e1717cc89ef409cb3/src/shared/errors/error-code.ts#L4)

Caller-supplied arguments were invalid (counts, names, empty batch).
