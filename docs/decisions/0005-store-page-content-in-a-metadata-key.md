# 5. Store page content in a metadata key

## Status

Accepted.

## Context

S3 Vectors stores a vector, a key and a metadata object. It has no notion of a
document body. LangChain's `Document` has `pageContent` and `metadata`, and a
retriever is useless if it returns embeddings without the text they came from.

The content therefore has to live inside the metadata object or nowhere.
Putting it there spends part of the per-vector metadata budget on text, and
makes the content visible to metadata filters, which is occasionally useful
and mostly not. Putting it nowhere means the store can only return ids and
metadata, which is a legitimate configuration for a caller who keeps their
documents elsewhere.

## Decision

We store page content under a metadata key, `_page_content` by default and
configurable through `pageContentMetadataKey`. Setting that option to `null`
means the content is embedded but not stored, and reads return documents with
empty content.

The key counts against the index's limits exactly as any other metadata key
does, and is refused at construction if it would not fit.

## Consequences

Positive. A document written through this package reads back as the same
document. A caller who keeps their own document store can opt out and spend
the whole metadata budget on their own fields.

Negative. Content competes with metadata for a fixed per-vector budget, and a
large document can push a write over it. The default key name is reserved by
convention only, so a caller's own metadata must not collide with it.

Neutral. Which key holds the content is invisible on both sides — the
transformation happens in one module, and changing the key changes nothing
else.
