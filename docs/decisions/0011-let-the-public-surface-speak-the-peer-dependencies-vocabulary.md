# 11. Let the public surface speak the peer dependencies' vocabulary

## Status

Accepted.

## Context

A package that takes a dependency is usually advised to define its own
interface and a thin wrapper, so that the dependency's types do not become part
of what it promises. Following that here would mean re-declaring
`EncryptionConfiguration`, the AWS credential-provider type, and the client
itself, and converting at the boundary.

The situation this package is in is not the one that advice describes. Both
`@aws-sdk/client-s3vectors` and `@langchain/core` are peer dependencies
(record 1): the consumer installs them, holds them, and is expected to already
be using them. A caller who wants to pass a client they configured has an
`S3VectorsClient` in hand. A caller implementing `EmbeddingsInterface` has
core's type in hand. Re-declaring those types would not hide anything — the
consumer would still have the real ones — and it would create a second
representation of the same shape that has to be kept in step, which is its own
class of bug.

The published declarations were checked: they reference `@langchain/core` and
`@aws-sdk/client-s3vectors`, and nothing else. `@smithy/types` had leaked into
the source but never into the surface.

## Decision

We let the two peer dependencies' types appear in the public surface where the
caller already holds a value of that type: the client, the credential
providers, the encryption configuration, `Document`, `EmbeddingsInterface`
and the `VectorStore` base class.

We do not let any other dependency's types appear there. What this package
returns from the wire — `S3OutputVector`, `S3VectorsRecord` — is declared here
rather than taken from the SDK's response types, because those are shapes a
caller reads rather than constructs, and the SDK's own are wider than what this
package guarantees.

## Consequences

Positive. A caller passes what they already have, with no conversion and no
cast. There is one representation of each shape, so nothing can drift. The
package's own types are reserved for things the package actually decides.

Negative. A breaking change in either peer's type surface is a breaking change
here, and this package cannot absorb it. Callers are coupled to two specific
libraries, which is inherent to being an integration between them but is worth
stating rather than discovering.

Neutral. The boundary is enforceable and enforced.
`test/contract/dependency-surface.test.ts` allows `src/` to import only node
builtins, a declared peer, or an enumerated exception stating its reason — and
requires every exception to be type-only, so none of them can reach run time.
One exception stands: `@smithy/types`, for the document type the SDK's own
command input declares.
