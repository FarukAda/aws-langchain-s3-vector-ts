# 9. Parse input at the boundary and carry the proof

## Status

Accepted.

## Context

Every public method accepts values a typed caller could not get wrong and an
untyped one can: a filter, a `k`, ids, vectors, an options bag. These were
checked by functions returning nothing, which left a checked value
indistinguishable from an unchecked one.

That had two costs, both already paid. Functions deep in the package accepted
`unknown` with a comment reading "already validated by the caller", which is a
promise the compiler cannot keep — and it was not kept: one search method
passed both its filter and its `k` through without checking either. Elsewhere
the same filter was checked twice on one call, because the boundary's check
left nothing behind that the action could see.

## Decision

We parse at the public boundary and return a branded type that only the parser
can construct. Functions downstream ask for the branded type, so a value that
was never parsed cannot reach them, and they do not check it again.

The brands are phantom: at run time the value is the caller's own. Where a
check cannot be expressed this way, the invariant is stated in the function's
contract.

## Consequences

Positive. Two classes of mistake became compiler errors rather than latent
holes. Duplicate checking disappeared instead of being tolerated. A reader can
tell from a signature whether a value has been checked.

Negative. Branded types are unfamiliar and appear in internal signatures,
which is a tax on every reader. The cast that applies a brand is a place where
a mistake would be silent, so each brand has exactly one constructor and that
function is where the check lives.

Neutral. Not every check is worth a brand; the ones applied are where an
unchecked value could otherwise reach the wire.
