/**
 * Decide whether this commit's CI is green enough to publish from.
 *
 * The gate this replaces counted rather than named: "some check runs exist and
 * none of them failed". That passes in the one case it most needs to catch —
 * `ci.yml` producing *no* check runs on the tagged commit, which a rename,
 * invalid YAML or a later-added `paths-ignore:` would cause. CodeQL and
 * Scorecard alone would then be a complete, green set, and the release would
 * publish a commit the six-leg operating-system × Node matrix never touched.
 *
 * So the required names are listed, and every one of them must be *present*
 * and successful. A required job renamed in `ci.yml` without being renamed
 * here makes the release time out instead of publishing, which is the right
 * way round — but it does mean the two files are edited together.
 *
 * Reads `CHECK_RUNS`: the newline-delimited JSON objects `gh api --paginate
 * --jq '.check_runs[] | {name, status, conclusion}'` emits. Reading it from the
 * environment rather than argv keeps a check-run name containing a quote from
 * having to survive a shell.
 *
 * Exit codes are the interface, because the caller loops on them:
 *   0 — every required check is present and successful. Publish.
 *   1 — a required check completed and did not succeed. Stop; waiting cannot help.
 *   2 — not there yet. Sleep and call again.
 */

/**
 * The check-run names a tagged commit must carry, all of them successful.
 *
 * Mostly `ci.yml`. The matrix legs are spelled out because a matrix job's
 * check-run name is its `name:` with the matrix values substituted, and a
 * missing leg is exactly what this gate exists to notice.
 *
 * `live-aws integration` comes from `integration-live.yml` instead, which runs
 * on the same tag push. That suite is the only thing that checks this package
 * against the real service — every other test runs against a mock — and a
 * 2026-09-20 run proved the point by catching a behaviour change the unit
 * suite had already moved past. Requiring it here is what makes "the live tier
 * runs before every tag" a gate rather than a good intention. A tag whose live
 * run failed, or never started because the AWS role secret is missing, waits
 * here and then refuses to publish.
 */
export const REQUIRED_CHECKS = [
  'lint + typecheck + hygiene',
  'peer dependency floors',
  'package smoke (pack + lint + install + import)',
  'npm audit (high+)',
  'live-aws integration',
  'test (node 22 on ubuntu-latest)',
  'test (node 22 on windows-latest)',
  'test (node 22 on macos-latest)',
  'test (node 24 on ubuntu-latest)',
  'test (node 24 on windows-latest)',
  'test (node 24 on macos-latest)',
  'test (node 26 on ubuntu-latest)',
  'test (node 26 on windows-latest)',
  'test (node 26 on macos-latest)',
];

/** Parse the newline-delimited JSON `gh api --paginate --jq` emits. */
export function parseCheckRuns(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Classify a commit's check runs against the required list.
 *
 * A check run counts as succeeded on `success`, and — as before — on `skipped`
 * and `neutral`, which a conditional job legitimately reports. Anything else
 * that has completed is a failure, `cancelled` and `timed_out` included.
 */
export function evaluate(checkRuns, required = REQUIRED_CHECKS) {
  const succeeded = new Set(
    checkRuns
      .filter(
        (run) =>
          run.status === 'completed' &&
          (run.conclusion === 'success' ||
            run.conclusion === 'skipped' ||
            run.conclusion === 'neutral'),
      )
      .map((run) => run.name),
  );
  const requiredNames = new Set(required);
  const failed = checkRuns.filter(
    (run) =>
      requiredNames.has(run.name) &&
      run.status === 'completed' &&
      !succeeded.has(run.name),
  );
  const pending = required.filter((name) => !succeeded.has(name));
  return { failed, pending, satisfied: required.length - pending.length, total: required.length };
}

// The entry point. `scripts/` is outside the coverage scope, so this is not
// instrumented; the exported functions above are what the tests exercise.
if (import.meta.filename === process.argv[1]) {
  const { failed, pending, satisfied, total } = evaluate(
    parseCheckRuns(process.env.CHECK_RUNS ?? ''),
  );

  if (failed.length > 0) {
    for (const run of failed) console.error(`  ${run.name}: ${run.conclusion}`);
    console.error('::error::A required CI check did not succeed for this commit; not publishing.');
    process.exit(1);
  }

  console.log(`Required CI checks: ${satisfied}/${total} present and successful`);
  if (pending.length === 0) process.exit(0);
  for (const name of pending) console.log(`  waiting on: ${name}`);
  process.exit(2);
}
