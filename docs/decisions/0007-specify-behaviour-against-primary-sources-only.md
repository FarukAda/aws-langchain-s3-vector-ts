# 7. Specify behaviour against primary sources only

## Status

Accepted.

## Context

There are other clients for this service, in this language and others, and
copying a limit, a batch size or an error classification from one of them is
faster than establishing it. It is also unreliable: a number copied without
its source cannot be re-derived when the service changes, and a behaviour
copied from another implementation may be that implementation's bug.

Parts of the service are undocumented. For those there is no primary source to
cite — only what the service actually does, which can be observed but goes
stale silently when nobody re-observes it.

## Decision

We specify every behaviour against the S3 Vectors API reference, the
`@aws-sdk/client-s3vectors` service model, or `@langchain/core`'s own source,
and cite it where it is implemented. What another implementation does is not a
source; a proposal argued that way is asked for the underlying reason instead.

Where AWS documents nothing, a claim needs two things: a probe recorded under
`docs/evidence/` with its raw request and response, and a named live test
asserting the same fact, so a live run fails if the service changes. The file
alone goes stale; the test alone cannot be reviewed without credentials.

## Consequences

Positive. Every constant in the package can be traced to something that can be
re-checked. Undocumented behaviour is held to a higher standard than
documented behaviour, not a lower one.

Negative. Establishing a fact costs a live AWS run against a real account,
which not every contributor can do. The evidence is only as fresh as the last
run, and the dates are recorded for exactly that reason.

Neutral. The rule is enforced by a contract test that fails on a reference to
another implementation in the source.
