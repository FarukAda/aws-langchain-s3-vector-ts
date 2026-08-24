# Dependency Upgrade & Open PR Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every dependency in `aws-langchain-s3-vector-ts` to its verified-current version, fix the CI/dependency drift represented by the 5 open dependabot PRs, and leave the repo green (build/lint/typecheck/test/docs/cpd/knip) on a new local feature branch.

**Architecture:** This is a dependency/config maintenance pass, not a feature — there is no new application logic, so tasks are edit-then-verify rather than red/green TDD. Each task edits `package.json` and/or `.github/workflows/*.yml`, then a later task runs the full verification suite once all edits land (grouping verification avoids re-running `npm install` after every single-line edit).

**Tech Stack:** npm, TypeScript (6.x via alias — see constraint below), Jest/ts-jest, ESLint flat config (`eslint.config.ts` via jiti), typedoc, jscpd (Rust CLI as of v5), knip, GitHub Actions.

**Spec:** No standalone spec doc — requirements were established live during planning by querying the npm registry, GitHub REST API, and current peer-dependency ranges (not training data). Key findings, which this plan's Global Constraints encode:
- `npm-check-updates` output supplied by the user, cross-checked against `npm view <pkg> version` for every package on 2026-08-24 — all versions confirmed current at plan time.
- TypeScript 7.0 (native Go compiler, GA 2026-07-08) ships with no compiler API. Confirmed via `npm view`: `ts-jest@29.4.12` peer `"typescript": ">=4.3 <7"`, `typescript-eslint@8.68.0` peer `"typescript": ">=4.8.4 <6.1.0"`, `typedoc@0.28.20` peer caps at `"6.0.x"`. WebSearch (InfoQ, Microsoft DevBlogs, digitalapplied.com, devencyclopedia.com) confirms the ecosystem is blocked on TS 7.1 for a stable API; a TS7-support request against typescript-eslint was closed "not planned" for now.
- 5 open PRs on `github.com/FarukAda/aws-langchain-s3-vector-ts` (checked via GitHub REST API, all `dependabot[bot]`): #48 (`@aws-sdk/client-s3vectors` 3.1057.0→3.1115.0), #44 (dev-dependencies group, 13 packages), #41 (`actions/setup-node` v6→v7), #33 (`actions/checkout` v6→v7), #30 (`@langchain/core` 1.1.48→1.1.49). All are stale relative to true current-latest and are fully superseded by this plan's version targets.
- `jscpd@5` is a ground-up Rust rewrite (confirmed via `npx jscpd@5.0.16 --help`): the `full` reporter is renamed `console-full` (aliases `full`/`consoleFull` still accepted), and the old `--verbose`/`-d`/`--debug` flag is **gone** — `--debug` now means "print merged config and exit". The sibling repo `aws-langgraph-dynamodb-ts` (already upgraded by the user) already reflects this: `cpd:full`/`cpd:test` dropped `--verbose` and switched to `console-full`. Independently verified against the live CLI, not copied blind.
- `actions/checkout@v7`'s only breaking behavior is refusing fork checkout under `pull_request_target`/`workflow_run` triggers — this repo's 3 workflows use only `push`/`workflow_dispatch`/`schedule`, so it's a no-op here. `actions/setup-node@v7` is an internal ESM rewrite with no input/output changes affecting our usage.
- `@langchain/core` 1.1.35→1.2.9 changelog (langchainjs monorepo) has no VectorStore/Embeddings-affecting changes in range. `@langchain/aws@1.4.4` peer-requires `@langchain/core: ^1.2.8`, satisfied by the 1.2.9 target.
- `@aws-sdk/client-s3vectors` 3.1057.0→3.1117.0 changelog: no breaking/renamed/removed fields across the 61-version span; only additive changes (paginated `QueryVectors`).
- User decision (asked directly, 2026-08-24): use the **alias pattern** for TypeScript (matches what the user already shipped in `aws-langgraph-dynamodb-ts`), and keep **all work local to a new branch** — no push, no PR open/close, until the user reviews.

## Global Constraints

- `engines.node` stays `>=22.14.0`, `engines.npm` stays `>=10.0.0` — do not touch.
- `typescript` stays on the 6.x compiler API via `npm:@typescript/typescript6@^6.0.2` alias; do **not** set `"typescript"` to a raw `^7.x` range anywhere — it breaks ts-jest, typescript-eslint, and typedoc today.
- `@typescript/native` (real `npm:typescript@^7.0.2`) is added as an extra, unused-by-tooling devDependency only — nothing in scripts should invoke it yet.
- No workflow file may gain a `pull_request` or `pull_request_target` trigger (standing project rule: CI never uses `pull_request`).
- No Claude/AI attribution anywhere (commit messages, code comments, docs).
- All commits stay local on the new branch — no `git push`, no `gh pr` create/close/comment commands in this plan.

---

## File Structure

- Modify: `package.json` — dependency/peerDependency/devDependency version bumps, `typescript`/`@typescript/native` alias swap, `cpd`/`cpd:full`/`cpd:test` script updates.
- Modify: `package-lock.json` — regenerated by `npm install`, not hand-edited.
- Modify: `.github/workflows/ci.yml` — `actions/checkout@v6→v7` (×3), `actions/setup-node@v6→v7` (×3).
- Modify: `.github/workflows/release.yml` — `actions/checkout@v6→v7` (×1), `actions/setup-node@v6→v7` (×1).
- Modify: `.github/workflows/integration-live.yml` — `actions/checkout@v6→v7` (×1), `actions/setup-node@v6→v7` (×1).

---

### Task 1: Create the feature branch

**Files:** none (git operation only)

- [ ] **Step 1: Confirm working tree is clean**

Run: `git -C "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts" status --porcelain`
Expected: empty output (matches the clean status already observed at session start).

- [ ] **Step 2: Create and switch to the branch**

Run: `git -C "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts" checkout -b deps/upgrade-2026-08`

- [ ] **Step 3: Verify**

Run: `git -C "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts" branch --show-current`
Expected: `deps/upgrade-2026-08`

---

### Task 2: Bump production + peer dependencies

**Files:**
- Modify: `package.json:67-74` (the `peerDependencies` and `dependencies` blocks)

**Interfaces:** none (config only)

- [ ] **Step 1: Edit `peerDependencies` and `dependencies`**

Change both occurrences (peerDependencies block and dependencies block) of:
```json
"@aws-sdk/client-s3vectors": "^3.1014.0",
"@langchain/core": "^1.1.35"
```
to:
```json
"@aws-sdk/client-s3vectors": "^3.1117.0",
"@langchain/core": "^1.2.9"
```

- [ ] **Step 2: Sanity check**

Run (from repo root): `node -e "const p=require('./package.json'); console.log(p.dependencies, p.peerDependencies)"`
Expected: both objects show `@aws-sdk/client-s3vectors: ^3.1117.0` and `@langchain/core: ^1.2.9`.

---

### Task 3: Bump devDependencies (excluding TypeScript)

**Files:**
- Modify: `package.json:76-101` (the `devDependencies` block)

- [ ] **Step 1: Apply these exact version bumps** (leave `typescript` and `typescript-eslint` line for now — typescript-eslint bump is included here, `typescript` itself is handled in Task 4)

```json
"@langchain/aws": "^1.4.4",
"@smithy/types": "^4.17.2",
"@types/node": "^26.2.0",
"eslint": "^10.9.1",
"eslint-plugin-perfectionist": "^5.10.1",
"fast-check": "^4.9.0",
"jscpd": "^5.0.16",
"knip": "^6.32.2",
"prettier": "^3.9.6",
"ts-jest": "^29.4.12",
"typedoc": "^0.28.20",
"typedoc-plugin-markdown": "^4.12.0",
"typescript-eslint": "^8.68.0"
```

All other devDependencies (`@eslint/js`, `@jest/globals`, `@types/jest`, `aws-sdk-client-mock`, `depcheck`, `eslint-config-prettier`, `eslint-plugin-no-instanceof`, `eslint-plugin-prettier`, `eslint-plugin-unused-imports`, `jest`, `jest-sonar`, `jiti`) are already at latest per `npx npm-check-updates` — leave untouched.

- [ ] **Step 2: Sanity check**

Run: `node -e "const p=require('./package.json').devDependencies; ['@langchain/aws','@smithy/types','@types/node','eslint','eslint-plugin-perfectionist','fast-check','jscpd','knip','prettier','ts-jest','typedoc','typedoc-plugin-markdown','typescript-eslint'].forEach(k=>console.log(k, p[k]))"`
Expected: each printed value matches the list above.

---

### Task 4: TypeScript alias pattern (do NOT bump `typescript` to raw `^7.x`)

**Files:**
- Modify: `package.json` — the `"typescript": "^6.0.3"` line inside `devDependencies`

**Interfaces:** none

- [ ] **Step 1: Replace the `typescript` line and add `@typescript/native` immediately after it**

Change:
```json
    "typedoc-plugin-markdown": "^4.11.0",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.60.0"
```
to (note `typescript-eslint` version already updated by Task 3):
```json
    "typedoc-plugin-markdown": "^4.12.0",
    "typescript": "npm:@typescript/typescript6@^6.0.2",
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript-eslint": "^8.68.0"
```

This mirrors the pattern already shipped in the sibling repo `aws-langgraph-dynamodb-ts/package.json`, independently verified against `ts-jest`/`typescript-eslint`/`typedoc` peer ranges in this plan's research (see Spec section) rather than copied blind.

- [ ] **Step 2: Sanity check**

Run: `node -e "const p=require('./package.json').devDependencies; console.log(p.typescript, p['@typescript/native'])"`
Expected: `npm:@typescript/typescript6@^6.0.2 npm:typescript@^7.0.2`

---

### Task 5: Update jscpd scripts for the v5 CLI

**Files:**
- Modify: `package.json:50-52` (the `cpd`, `cpd:full`, `cpd:test` scripts)

- [ ] **Step 1: Edit the scripts**

Change:
```json
"cpd": "jscpd ./src --threshold 2 --min-lines 3 --reporters console --silent --format typescript,javascript",
"cpd:full": "jscpd ./src --threshold 2 --min-lines 3 --reporters console --verbose --format typescript,javascript",
"cpd:test": "jscpd ./test --threshold 2 --min-lines 3 --reporters console --verbose --format typescript,javascript"
```
to:
```json
"cpd": "jscpd ./src --threshold 2 --min-lines 3 --reporters console --silent --format typescript,javascript",
"cpd:full": "jscpd ./src --threshold 2 --min-lines 3 --reporters console-full --format typescript,javascript",
"cpd:test": "jscpd ./test --threshold 2 --min-lines 3 --reporters console-full --format typescript,javascript"
```

`cpd` itself is unchanged — the plain `console` reporter and `--silent` flag both still exist in jscpd v5 (confirmed via `npx jscpd@5.0.16 --help`). Only `cpd:full`/`cpd:test` used the now-removed `--verbose` flag and the renamed `full`→`console-full` reporter.

- [ ] **Step 2: Sanity check (after Task 6 installs jscpd — do not run yet)**

Deferred to Task 8.

---

### Task 6: Install and regenerate the lockfile

**Files:**
- Modify: `package-lock.json` (generated)

- [ ] **Step 1: Install**

Run: `npm install` (from repo root)
Expected: exits 0, `package-lock.json` is rewritten, no `ERESOLVE` peer-dependency errors (the `@langchain/aws@1.4.4` → `@langchain/core@^1.2.8` peer requirement is satisfied by Task 2's `@langchain/core@^1.2.9` bump).

- [ ] **Step 2: Confirm the typescript alias resolved correctly**

Run: `node -e "console.log(require('./node_modules/typescript/package.json').version)"`
Expected: `6.0.2` (the aliased `@typescript/typescript6` package, not a 7.x version).

Run: `node -e "console.log(require('./node_modules/@typescript/native/package.json').version)"`
Expected: `7.0.2`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: upgrade all dependencies to verified-current versions"
```

---

### Task 7: Bump GitHub Actions versions in workflows

**Files:**
- Modify: `.github/workflows/ci.yml:20,21,38,39,51,52`
- Modify: `.github/workflows/release.yml:22,29`
- Modify: `.github/workflows/integration-live.yml:31,32`

- [ ] **Step 1: `ci.yml`** — replace all 3 `uses: actions/checkout@v6` with `uses: actions/checkout@v7`, and all 3 `uses: actions/setup-node@v6` with `uses: actions/setup-node@v7` (lint job, test job, audit job).

- [ ] **Step 2: `release.yml`** — replace the single `uses: actions/checkout@v6` with `uses: actions/checkout@v7`, and the single `uses: actions/setup-node@v6` with `uses: actions/setup-node@v7`.

- [ ] **Step 3: `integration-live.yml`** — replace the single `uses: actions/checkout@v6` with `uses: actions/checkout@v7`, and the single `uses: actions/setup-node@v6` with `uses: actions/setup-node@v7`.

- [ ] **Step 4: Verify no stray v6 references remain**

Run: `grep -rn "actions/checkout@v6\|actions/setup-node@v6" "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts\.github\workflows"`
Expected: no matches.

- [ ] **Step 5: Verify none of the 3 workflows gained a `pull_request`/`pull_request_target` trigger**

Run: `grep -n "^on:" -A5 "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts\.github\workflows\ci.yml" "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts\.github\workflows\release.yml" "C:\Users\info\Documents\Projects\AI-Libs\aws-langchain-s3-vector-ts\.github\workflows\integration-live.yml"`
Expected: `push`/`workflow_dispatch` (ci.yml), `push` tags (release.yml), `schedule`/`workflow_dispatch` (integration-live.yml) only — matches Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/integration-live.yml
git commit -m "ci: bump actions/checkout and actions/setup-node to v7"
```

---

### Task 8: Full verification suite

**Files:** none (verification only — fix-forward if anything fails, in the affected file, then re-run)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 2: Typecheck published types**

Run: `npm run typecheck:types`
Expected: exits 0.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exits 0. (typescript-eslint 8.68.0 against the aliased TS 6.0.2 — within its `<6.1.0` peer cap, confirmed in Task-planning research.)

- [ ] **Step 4: Unit tests**

Run: `npm test -- --ci`
Expected: all suites pass.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exits 0, `dist/` regenerated.

- [ ] **Step 6: Package smoke test**

Run: `npm run test:package-smoke`
Expected: exits 0.

- [ ] **Step 7: Duplicate-code check**

Run: `npm run cpd` then `npm run cpd:full` then `npm run cpd:test`
Expected: all three exit 0 using the new `console-full` reporter (Task 5) without CLI flag errors.

- [ ] **Step 8: Docs generation**

Run: `npm run docs`
Expected: exits 0 (typedoc 0.28.20 against aliased TS 6.0.2 — within its `6.0.x` peer cap).

- [ ] **Step 9: Unused-code check**

Run: `npm run unused`
Expected: runs to completion (report may list pre-existing findings unrelated to this change — do not fix unrelated knip findings in this task; only investigate if the dependency bump introduced new ones).

- [ ] **Step 10: If anything failed** — fix forward in the relevant file (do not revert dependency versions unless a fix is impossible), then re-run only the failed step. Do not proceed to Task 9 until every step above is green.

- [ ] **Step 11: Commit any fix-forward changes**

```bash
git add -A
git commit -m "fix: address fallout from dependency upgrade"
```
(skip this step if Step 10 required no changes)

---

### Task 9: Final review

**Files:** none

- [ ] **Step 1: Full diff review against main**

Run: `git diff main...deps/upgrade-2026-08 --stat`
Expected: only `package.json`, `package-lock.json`, and the 3 workflow files (plus any fix-forward files from Task 8) are listed.

- [ ] **Step 2: Confirm branch is still local**

Run: `git status -sb`
Expected: shows `## deps/upgrade-2026-08` with no `[ahead/behind origin]` marker (branch has no upstream yet — nothing pushed).

- [ ] **Step 3: Report to user**

Summarize: branch name, every version bump applied, the TypeScript alias decision and why, the jscpd script changes, the Actions bumps, and that this branch supersedes open PRs #48, #44, #41, #33, #30 (do not push or touch those PRs — that was explicitly deferred to a separate user-approved step).

---

## Self-Review

**Spec coverage:**
- Every package in the user's `npm-check-updates` list has a task: #48/#44/#30-equivalent deps → Task 2/3, `typescript` special-case → Task 4, jscpd script fallout → Task 5, `actions/setup-node`/`actions/checkout` (#41/#33) → Task 7. ✅
- "Fix all 5 open PRs in the new feature branch" → Tasks 2–7 collectively produce a superset of every one of those PRs' changes, at truly current (not stale) versions, on the new branch created in Task 1. PR close/comment actions are explicitly out of scope per the user's own choice. ✅
- "Use MCP/websearch, nothing from training data" → satisfied during planning (recorded in the Spec section above), not something a task needs to re-verify at execution time.

**Placeholder scan:** No TBD/"add appropriate"/"similar to Task N" patterns — every task has literal before/after text or exact commands.

**Type consistency:** N/A — no new functions/interfaces introduced by this plan.