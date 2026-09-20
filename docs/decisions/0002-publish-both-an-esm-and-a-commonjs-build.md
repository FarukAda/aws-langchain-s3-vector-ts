# 2. Publish both an ESM and a CommonJS build

## Status

Accepted.

## Context

The package is written as ES modules and targets Node 22 and above, where ESM
is fully supported. The Node ecosystem it is used from is not uniformly there:
a substantial number of applications and test harnesses still load modules with
`require`, and several bundlers resolve the `require` condition even for code
that will eventually run as ESM.

Publishing ESM only would refuse those consumers outright. Publishing CommonJS
only would lose named-export ergonomics and leave the package out of step with
where the ecosystem is going. Publishing both doubles what has to be built and
introduces a failure mode that is invisible in this repository: an `exports`
map whose `require` condition lands on an ES module, or whose `types`
condition points at declarations that do not match the JavaScript beside them.

## Decision

We build both trees from one source and publish them behind an `exports` map
with explicit `import` and `require` conditions, each with its own `types`
entry. The CommonJS tree carries a `package.json` declaring
`"type": "commonjs"` so Node reads it correctly regardless of the root
`"type": "module"`.

We check the published shape rather than assuming it. Every release candidate
is packed, linted with `publint`, resolved with `arethetypeswrong` from ESM,
CommonJS and bundler perspectives, and then installed into a throwaway project
that imports it three ways — `import`, `require`, and a TypeScript consumer
type-checked against the shipped declarations.

## Consequences

Positive. The package works from both module systems, and the way it is
consumed is verified against a real tarball rather than against this
repository's own TypeScript program, which resolves paths differently from how
a consumer does.

Negative. Two builds, two declaration sets and roughly a minute of CI spent on
packing and installing. Any change to the `exports` map is high risk and
cannot be validated by type checking alone.

Neutral. The source stays single: nothing is written twice, and the CommonJS
tree is a compilation target rather than a parallel implementation.
