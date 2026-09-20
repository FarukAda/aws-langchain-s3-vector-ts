# 3. Surface one error class, distinguished by a code

## Status

Accepted.

## Context

Failures here come from three places: this package's own checks, the AWS
service, and code the caller supplied, such as an embeddings model. A caller
catching them needs to decide one of a few things — retry, ask for a quota,
fix an argument, call an operator — and that decision does not map one-to-one
onto the exception names the service uses.

The usual alternative is a class hierarchy, one subclass per failure kind.
That makes `instanceof` the natural test, and `instanceof` is unreliable in
exactly the situations this package ships into: a bundler that duplicates a
module across a boundary, an error crossing a realm, or a consumer loading
both the ESM and the CommonJS copy of this package. In all three, a legitimate
error fails its own type test.

## Decision

We raise one class, `S3VectorsError`, carrying a `code` from a stable enum, a
`context` naming the operation and the index, and a `cause`. Recognition is a
`Symbol.for` brand tested by `isS3VectorsError`, not a prototype check; the
`no-instanceof` lint rule keeps `instanceof` out of the package entirely.

A new code is added only when a caller would respond to it differently from
every existing one, and it may arrive in a minor. The set only grows: a value
is never removed, never renamed and never reassigned to a different condition,
so a code that was stored or logged keeps its meaning for the life of a major.

## Consequences

Positive. One `catch` and a `switch` is the whole error-handling story. The
brand survives realms, bundler duplication and the two module copies. Because
codes are coarser than the service's exception names, the set stays small
enough to read.

Negative. A caller who wants compile-time exhaustiveness pays for the set
growing within a major. A new member compiles in a `switch` with a `default`
and in an `if` on a single code; it breaks `Record<S3VectorsErrorCode, T>` and
a `never`-typed exhaustiveness assertion. The bar for a new code is
correspondingly high, and some genuinely different failures share one. Callers
who want a subclass hierarchy do not get one.

Neutral. `context` is where anything operation-specific lives, which keeps the
class shape fixed while letting individual failures carry more.
