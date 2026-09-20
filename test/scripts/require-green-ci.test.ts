/**
 * The release gate's classification, exercised off a runner.
 *
 * This is the check that stands between `git push --tags` and a live `latest`,
 * and the failure it exists to catch is silent: a `ci.yml` that produced no
 * check runs at all on the tagged commit — after a rename, a YAML error, or a
 * `paths-ignore:` added later — leaves CodeQL and Scorecard as a complete,
 * green set. The gate it replaced counted rather than named, so that set
 * passed and the release published a commit the six-leg matrix never touched.
 *
 * `scripts/` is outside `collectCoverageFrom`, so nothing here moves the
 * coverage gate; these run because a release gate that has never been
 * exercised is not a gate.
 */
import { describe, expect, it } from '@jest/globals';

// A plain .mjs with no types of its own: this is the release tooling, not the
// package's own source, and it stays outside the TypeScript program.
// @ts-expect-error — untyped ESM script under scripts/
import { evaluate, parseCheckRuns, REQUIRED_CHECKS } from '../../scripts/require-green-ci.mjs';

interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

interface Verdict {
  readonly failed: readonly CheckRun[];
  readonly pending: readonly string[];
  readonly satisfied: number;
  readonly total: number;
}

const required: readonly string[] = REQUIRED_CHECKS;
const classify = evaluate as (runs: readonly CheckRun[]) => Verdict;
const parse = parseCheckRuns as (text: string) => CheckRun[];

const succeeded = (name: string): CheckRun => ({
  name,
  status: 'completed',
  conclusion: 'success',
});
const allGreen = (): CheckRun[] => required.map(succeeded);
const allGreenExcept = (name: string, run: CheckRun): CheckRun[] => [
  ...required.filter((candidate) => candidate !== name).map(succeeded),
  run,
];

describe('the required list', () => {
  it('names every job ci.yml produces, including each matrix leg', () => {
    // Spelled out rather than derived: deriving it from ci.yml would make the
    // gate agree with whatever ci.yml currently says, which is the opposite of
    // what it is for.
    expect(required).toEqual([
      'lint + typecheck + hygiene',
      'peer dependency floors',
      'package smoke (pack + lint + install + import)',
      'npm audit (high+)',
      'test (node 22 on ubuntu-latest)',
      'test (node 22 on windows-latest)',
      'test (node 22 on macos-latest)',
      'test (node 24 on ubuntu-latest)',
      'test (node 24 on windows-latest)',
      'test (node 24 on macos-latest)',
    ]);
  });
});

describe('evaluate', () => {
  it('is satisfied when every required check succeeded', () => {
    const verdict = classify(allGreen());
    expect(verdict).toMatchObject({ pending: [], failed: [], satisfied: required.length });
  });

  it('is NOT satisfied when only checks outside the list ran', () => {
    // The case the gate exists for: ci.yml produced nothing, and the green
    // checks present belong to other workflows entirely.
    const verdict = classify([succeeded('CodeQL'), succeeded('Scorecard analysis')]);
    expect(verdict.satisfied).toBe(0);
    expect(verdict.pending).toEqual(required);
    expect(verdict.failed).toEqual([]);
  });

  it('reports a required check that completed without succeeding', () => {
    const verdict = classify(
      allGreenExcept('npm audit (high+)', {
        name: 'npm audit (high+)',
        status: 'completed',
        conclusion: 'failure',
      }),
    );
    expect(verdict.failed.map((run) => run.name)).toEqual(['npm audit (high+)']);
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])(
    'treats a required check concluding %s as failed, not pending',
    (conclusion) => {
      const name = 'test (node 24 on macos-latest)';
      const verdict = classify(allGreenExcept(name, { name, status: 'completed', conclusion }));
      expect(verdict.failed.map((run) => run.name)).toEqual([name]);
    },
  );

  it.each(['skipped', 'neutral'])(
    'treats a required check concluding %s as succeeded',
    (conclusion) => {
      const name = 'test (node 22 on windows-latest)';
      const verdict = classify(allGreenExcept(name, { name, status: 'completed', conclusion }));
      expect(verdict).toMatchObject({ failed: [], pending: [] });
    },
  );

  it('leaves a still-running required check pending rather than failed', () => {
    const name = 'test (node 24 on ubuntu-latest)';
    const verdict = classify(
      allGreenExcept(name, { name, status: 'in_progress', conclusion: null }),
    );
    expect(verdict.pending).toEqual([name]);
    expect(verdict.failed).toEqual([]);
  });

  it('accepts a re-run: a failed attempt and a later success under one name', () => {
    // GitHub keeps both check runs after a re-run, so the failed attempt is
    // still in the response. Requiring "no failed run of this name" would make
    // a re-run unable to unblock a release, which is the point of re-running.
    const verdict = classify([
      ...allGreen(),
      { name: 'test (node 22 on windows-latest)', status: 'completed', conclusion: 'failure' },
    ]);
    expect(verdict).toMatchObject({ failed: [], pending: [] });
  });

  it('ignores a failing check that is not on the list', () => {
    const verdict = classify([
      ...allGreen(),
      { name: 'some-external-bot', status: 'completed', conclusion: 'failure' },
    ]);
    expect(verdict).toMatchObject({ failed: [], pending: [] });
  });

  it('holds everything pending when the commit has no check runs at all', () => {
    expect(classify([]).pending).toEqual(required);
  });
});

describe('parseCheckRuns', () => {
  it('reads the newline-delimited JSON gh api --paginate --jq emits', () => {
    const text =
      '{"name":"a","status":"completed","conclusion":"success"}\n' +
      '{"name":"b","status":"queued","conclusion":null}\n';
    expect(parse(text)).toEqual([
      { name: 'a', status: 'completed', conclusion: 'success' },
      { name: 'b', status: 'queued', conclusion: null },
    ]);
  });

  it('tolerates the blank lines a paginated response leaves between pages', () => {
    expect(parse('\n{"name":"a","status":"queued","conclusion":null}\n\n\n')).toHaveLength(1);
  });

  it('reads an empty response as no check runs', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   \n  ')).toEqual([]);
  });

  it('a check-run name containing a quote survives the round trip', () => {
    // Names reach the script through the environment rather than argv for
    // exactly this reason.
    const name = 'test ("node 24" on macos-latest)';
    expect(parse(JSON.stringify({ name, status: 'queued', conclusion: null }))[0]!.name).toBe(name);
  });
});
