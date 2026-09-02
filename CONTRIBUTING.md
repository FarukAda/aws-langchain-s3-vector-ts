# Contributing

Contributions are welcome — please open an issue to discuss non-trivial changes before submitting a PR.

## Local Development

```bash
git clone https://github.com/FarukAda/aws-langchain-s3-vector-ts.git
cd aws-langchain-s3-vector-ts
nvm use                # reads .nvmrc → Node 22 (the package itself supports Node >=20; see engines.node)
npm ci
npm test               # unit tests, enforced at 100% coverage
npm run build
```

## Before Opening a PR

- `npm run lint` and `npm run typecheck` must pass with no output.
- `npm test` must pass with 100% statement/branch/function/line coverage (enforced by the Jest `coverageThreshold` in `jest.config.cjs` — a PR that drops coverage fails CI).
- `npm run build` and `npm run pack:check` must succeed; the latter guards the tarball's listing and its `exports` map (publint, arethetypeswrong) after a change to `package.json` or the build configuration.
- New behavior needs new tests; behavioral changes need a `CHANGELOG.md` entry under `## [Unreleased]` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format).
- CI (`.github/workflows/ci.yml`) runs lint, every typecheck, knip, depcheck, jscpd, actionlint, a docs-drift check, the full test matrix (3 OS × Node 20/22/24), a build, `npm audit` over the whole installed tree, the package checks (`npm run pack:check`, then the packed-tarball smoke that imports, requires and type-checks the published surface), and the type checks plus unit tier against every peer at the floor of its declared range — on every push to `main` and every PR targeting it. A PR that changes `src/` without a `CHANGELOG.md` entry fails. `codeql.yml` (static analysis) and `dependency-review.yml` (fails on a newly-introduced high-severity+ vulnerable dependency) run alongside it on PRs targeting `main`; `scorecard.yml` runs weekly and on push to `main`, publishing a security-practices score to the public [OpenSSF Scorecard](https://scorecard.dev/) dataset.

## Coding Standards

- **TypeScript strict mode** plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.
- **ESLint flat config** (`eslint.config.ts`) with `typescript-eslint` recommended-type-checked rules, Prettier, and import sorting via `eslint-plugin-perfectionist`.
- **No-`instanceof` rule** enforced — use brand symbols or type guards instead (see `src/shared/stub-embeddings.ts` and `src/shared/errors/s3-vectors-error.ts` for the pattern).
- **Commit style:** Conventional Commits (`feat`, `fix`, `refactor`, `test`, `chore`, `docs`).
- No unused exports/files (`npm run unused`, backed by `knip`), no unused/missing dependencies (`npx depcheck .`), and no duplicated code blocks (`npm run cpd`, backed by `jscpd`) — run these in addition to lint/typecheck before opening a PR.

## Behavioural Parity with Python

This package tracks [`langchain_aws.vectorstores.s3_vectors.base.AmazonS3Vectors`](https://github.com/langchain-ai/langchain-aws/blob/main/libs/aws/langchain_aws/vectorstores/s3_vectors/base.py) for behaviour. Batch sizes, metadata conventions, and duplicate-ID deep-copy semantics all match the Python reference. If upstream Python fixes a bug or adds a feature, please open an issue so we can port it here — and if a deliberate divergence from Python is needed (e.g. a safety guard Python doesn't have), call it out explicitly in the PR description.

## Reporting Bugs

Use [GitHub Issues](https://github.com/FarukAda/aws-langchain-s3-vector-ts/issues). Include: package version, Node version, a minimal reproduction, and the actual vs. expected behavior. For security vulnerabilities, see [`SECURITY.md`](./SECURITY.md) instead — do not open a public issue.

## Release Process

Releases are handled by the maintainer via a tag-triggered GitHub Actions workflow (`.github/workflows/release.yml`) using npm Trusted Publishing (OIDC) — no manual `npm publish` or long-lived npm token involved. Version numbers follow [Semantic Versioning](https://semver.org/); for a `0.x` package, breaking changes bump the minor version.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
