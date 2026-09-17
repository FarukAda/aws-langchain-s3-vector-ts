[**AWS LangChain S3 Vector TypeScript**](../README.md)

***

[AWS LangChain S3 Vector TypeScript](../README.md) / S3VectorsListParams

# Interface: S3VectorsListParams

Defined in: [types.ts:325](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L325)

Options accepted by [AmazonS3Vectors.listDocuments](../classes/AmazonS3Vectors.md#listdocuments) and
[AmazonS3Vectors.listVectors](../classes/AmazonS3Vectors.md#listvectors).

There is no `filter`: `ListVectors` accepts none, and emulating one by
enumerating and discarding would bill for every vector in the index while
looking like a server-side filter.

## Properties

### pageSize?

> `readonly` `optional` **pageSize?**: `number`

Defined in: [types.ts:332](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L332)

Vectors requested per `ListVectors` call: an integer 1-1000. Advisory —
AWS stops a page at 1 MB of processed data regardless, so a short page is
normal and only an absent `nextToken` ends the listing.

#### Default Value

```ts
the service default of 500
```

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:338](https://github.com/FarukAda/aws-langchain-s3-vector-ts/blob/main/src/types.ts#L338)

Abort an in-progress listing. Checked before each page and threaded into
the request, so it both cancels the page in flight and stops the next one
from being requested.
