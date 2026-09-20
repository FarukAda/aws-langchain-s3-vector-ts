# 1. Publish the AWS SDK and @langchain/core as peer dependencies

## Status

Accepted.

## Context

This package is a vector store implementation that a LangChain application
installs alongside code it already has. That application almost always already
depends on `@langchain/core`, and frequently on `@aws-sdk/client-s3vectors`
too, either directly or through another AWS integration.

Two things follow from the way npm resolves versions. If this package declared
them as ordinary dependencies, a consumer whose own `@langchain/core` differed
in range would end up with two copies in the tree. Two copies of
`@langchain/core` means two `Document` classes and two `VectorStore` base
classes, and a document constructed by one is not an instance of the other —
which breaks the very interoperability the package exists to provide. Two
copies of the AWS SDK means two credential chains and two client
configurations, with a caller's `client` option silently belonging to the
wrong one.

The cost of peer dependencies falls on the consumer: they must install those
packages themselves, and a version outside the declared range produces a
warning or, under strict package managers, an install failure. The cost of
ordinary dependencies falls on this package's correctness, and it is not
visible until run time.

## Decision

We declare `@aws-sdk/client-s3vectors` and `@langchain/core` as
`peerDependencies`, with no runtime `dependencies` at all. We also install
them as `devDependencies` so the repository can build and test itself.

We verify the floor of each declared range in CI rather than trusting it: a job
installs every peer at the lowest version its range admits and runs the type
checks and the unit tier against it.

## Consequences

Positive. There is exactly one `Document` class and one client per
application. A consumer controls their own AWS SDK version, which matters
because the SDK ships fixes on its own schedule. The published package has no
runtime dependency tree of its own, so nothing here can pull in a transitive
package a consumer did not choose.

Negative. Installation is a step longer, and a consumer on an old
`@langchain/core` sees an install warning this package cannot suppress. The
declared floors are a promise that has to be kept; keeping it costs a CI job
that installs an unusual combination of versions and is slower than the others.
`npm audit` needed care: with no runtime dependencies, auditing with
`--omit=dev` examined an empty tree and passed unconditionally.

Neutral. The devDependency copies mean the repository's own tests run against
the newest versions in range rather than the floors, which is why the floors
need their own job.
