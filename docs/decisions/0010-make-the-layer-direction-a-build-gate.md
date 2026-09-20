# 10. Make the layer direction a build gate

## Status

Accepted.

## Context

The package is arranged in layers — declarations, shared utilities, internal
mechanics, actions, the store classes, the entry point — and that arrangement
is what keeps a change local. Nothing enforced it. Four imports had
accumulated that ran the wrong way, and every one of them was `import type`,
which erases at run time and therefore produced no cycle, no failing test and
nothing for a reviewer to notice. They were found by drawing the graph by
hand.

A rule nobody can check is a convention, and conventions decay in the
direction of whatever is convenient at the moment.

## Decision

We record the permitted direction in a contract test that places every module
in a layer and fails on an import reaching a later one, or on a module the
table does not place. Exceptions are enumerated in that table with the reason
they exist and what removing them would cost, and a stale exception fails too,
so the list can only shrink by accident.

## Consequences

Positive. The decomposition is checked on every change, at the point where the
author can still act on it. A new module cannot escape the rule by being
unlisted.

Negative. The rule lives in a test rather than in the editor, so a violation
surfaces at test time rather than while typing. One real exception remains:
the error context names the store class, because a caller recovers through it,
and removing that edge means changing a published type.

Neutral. The layers were already there; this writes them down.
