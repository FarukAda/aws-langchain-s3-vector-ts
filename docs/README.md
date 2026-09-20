**AWS LangChain S3 Vector TypeScript**

***

# AWS LangChain S3 Vector TypeScript

LangChain-compatible Amazon S3 Vectors store for TypeScript.

Hides where anything lives.

This module re-exports and declares nothing of its own, so the internal
arrangement — which module holds the store, the retriever, the error class
or the metadata helper — is free to change without moving anything a caller
imports. What appears here is the whole supported surface; a name reachable
by a deep import is not part of it.

## Enumerations

- [S3VectorsErrorCode](enumerations/S3VectorsErrorCode.md)

## Classes

- [AmazonS3Vectors](classes/AmazonS3Vectors.md)
- [AmazonS3VectorsRetriever](classes/AmazonS3VectorsRetriever.md)
- [S3VectorsError](classes/S3VectorsError.md)

## Interfaces

- [AmazonS3VectorsConfig](interfaces/AmazonS3VectorsConfig.md)
- [AmazonS3VectorsRetrieverFields](interfaces/AmazonS3VectorsRetrieverFields.md)
- [S3OutputVector](interfaces/S3OutputVector.md)
- [S3VectorsDeleteIndexOptions](interfaces/S3VectorsDeleteIndexOptions.md)
- [S3VectorsDeleteOptions](interfaces/S3VectorsDeleteOptions.md)
- [S3VectorsErrorContext](interfaces/S3VectorsErrorContext.md)
- [S3VectorsListOptions](interfaces/S3VectorsListOptions.md)
- [S3VectorsRecord](interfaces/S3VectorsRecord.md)

## Type Aliases

- [AmazonS3VectorsRetrieverInput](type-aliases/AmazonS3VectorsRetrieverInput.md)
- [DistanceMetric](type-aliases/DistanceMetric.md)
- [VectorDataType](type-aliases/VectorDataType.md)

## Functions

- [cosineRelevanceScoreFn](functions/cosineRelevanceScoreFn.md)
- [flattenMetadata](functions/flattenMetadata.md)
- [isS3VectorsError](functions/isS3VectorsError.md)
