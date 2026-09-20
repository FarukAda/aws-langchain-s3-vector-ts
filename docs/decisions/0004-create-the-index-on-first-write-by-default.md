# 4. Create the index on the first write, by default

## Status

Accepted.

## Context

S3 Vectors separates the vector bucket, which an operator creates, from the
index inside it, which is created through the API. An index's configuration —
its dimension, distance metric and non-filterable metadata keys — is fixed at
creation and cannot be changed afterwards; there is no `UpdateIndex`.

A store that refuses to write until someone has created the index is safe and
tedious: it makes the common case, a developer trying the package, a two-step
process where the second step needs a dimension they may not know until they
have embedded something. A store that creates the index silently is convenient
and dangerous: it fixes an irreversible configuration from whatever defaults
were in effect.

Concurrency makes it worse. Several writes starting at once on a fresh index
would each try to create it.

## Decision

We create the index on the first write when `createIndexIfNotExist` is true,
which is the default, taking the dimension from the first batch's vectors. One
check per store is shared by every write that starts while it is outstanding,
and its result is cached, so concurrent first writes produce one creation
attempt and every waiter is answered under its own operation name.

We refuse at construction any configuration that could not create a valid
index, rather than discovering it at the first write.

## Consequences

Positive. The package works from a bare vector bucket with no ceremony. The
dimension is taken from real vectors rather than declared and possibly wrong.
The creation race is resolved once, in one module, rather than at each write.

Negative. A misconfigured store creates an index that cannot be reconfigured,
only deleted and rebuilt. A typo in an option name would have produced exactly
that, which is why a near-miss option name is refused at construction.

Neutral. Operators who prefer to provision indexes themselves set
`createIndexIfNotExist: false` and get the refusing behaviour.
