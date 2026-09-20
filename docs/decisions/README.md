# Decision records

One record per decision that is expensive to reverse: what the situation was,
what we decided, and what it costs. They are written for a future developer
who is wondering why something is the way it is, and who would otherwise have
to reconstruct the reasoning from the code, which does not contain it.

Records are numbered sequentially and a number is never reused. A decision
that is later reversed keeps its record, marked superseded and pointing at the
one that replaced it, because the reasoning that led to it is what explains
why the replacement was needed.

`test/contract/decision-records.test.ts` checks the shape: the five sections,
the numbering, and that no number is used twice.

| # | Decision | Status |
|---|---|---|
| [1](0001-publish-the-aws-sdk-and-langchain-core-as-peer-dependencies.md) | Publish the AWS SDK and `@langchain/core` as peer dependencies | Accepted |
| [2](0002-publish-both-an-esm-and-a-commonjs-build.md) | Publish both an ESM and a CommonJS build | Accepted |
| [3](0003-surface-one-error-class-distinguished-by-a-code.md) | Surface one error class, distinguished by a code | Accepted |
| [4](0004-create-the-index-on-first-write-by-default.md) | Create the index on the first write, by default | Accepted |
| [5](0005-store-page-content-in-a-metadata-key.md) | Store page content in a metadata key | Accepted |
| [6](0006-pace-writes-against-the-documented-per-index-limits.md) | Pace writes against the documented per-index limits | Accepted |
| [7](0007-specify-behaviour-against-primary-sources-only.md) | Specify behaviour against primary sources only | Accepted |
| [8](0008-gate-the-build-on-complete-coverage.md) | Gate the build on complete coverage | Accepted |
| [9](0009-parse-input-at-the-boundary-and-carry-the-proof.md) | Parse input at the boundary and carry the proof | Accepted |
| [10](0010-make-the-layer-direction-a-build-gate.md) | Make the layer direction a build gate | Accepted |
| [11](0011-let-the-public-surface-speak-the-peer-dependencies-vocabulary.md) | Let the public surface speak the peer dependencies’ vocabulary | Accepted |
