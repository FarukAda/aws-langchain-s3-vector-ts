# 8. Gate the build on complete coverage

## Status

Accepted.

## Context

This package's job is to be correct at a boundary a consumer cannot easily
test themselves: their alternative is a live AWS account and real spend. Most
of what it does is refuse bad input in a way that names what is wrong, and a
refusal path that is never executed is a refusal that may not work.

A coverage target below 100% invites the question of which lines are allowed
to be uncovered, and the answer drifts. A target at 100% removes that question
and replaces it with a different one: whether the line should exist.

## Decision

We fail the build on anything below 100% of statements, branches, functions
and lines.

## Consequences

Positive. Every branch, including every error path, has been executed at least
once. When a refactor leaves a branch unreachable, the gate says so rather
than letting dead code accumulate.

Negative. The gate can be satisfied by tests that execute a line without
asserting anything useful, so it measures the wrong thing if trusted alone. It
also makes defensive code expensive to keep, which is a pressure towards
deleting genuinely useful guards; the answer is to test them, not to remove
them.

Neutral. Type-only modules compile to nothing and are not instrumented, so
they neither help nor hurt the number.
