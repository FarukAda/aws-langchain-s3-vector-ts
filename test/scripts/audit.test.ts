/**
 * The audit gate fails on every high or critical advisory except the few this
 * repository has decided to carry, each by its GHSA id and with a reason.
 *
 * `npm audit` cannot leave out a single advisory: `--audit-level` is the only
 * filter, and it is all or nothing. An advisory with no patched release would
 * therefore keep CI and the release red until upstream acts, or push the gate
 * down to `critical` for everything. The exception list is the narrower answer,
 * and these tests hold it narrow: an unlisted advisory still fails, a listed
 * one is matched by id rather than by package, and one that no longer occurs is
 * reported so it can be removed.
 */
import { describe, expect, it } from '@jest/globals';

// @ts-expect-error — untyped ESM script under scripts/
import { evaluateAudit, IGNORED_ADVISORIES } from '../../scripts/audit.mjs';

interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
}
interface Verdict {
  blocking: Advisory[];
  ignored: string[];
  stale: string[];
}
const evaluate = evaluateAudit as (report: unknown, ignored?: Map<string, string>) => Verdict;
const carried = IGNORED_ADVISORIES;

const advisory = (id: string, name: string, severity: string) => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} is vulnerable`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '*',
});

/**
 * An `npm audit --json` report (auditReportVersion 2). A package reached only
 * through another has its `via` as that package's name; the package the
 * advisory is about has the advisory object itself.
 */
const report = (vulnerabilities: Record<string, unknown>) => ({
  auditReportVersion: 2,
  vulnerabilities,
});

const BRACES = 'GHSA-vfj7-8cjw-p6xm';

/** The tree as it stood on 2026-10-14: braces high, reached through depcheck. */
const bracesTree = report({
  braces: { name: 'braces', severity: 'high', via: [advisory(BRACES, 'braces', 'high')] },
  micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
  'findup-sync': { name: 'findup-sync', severity: 'high', via: ['micromatch'] },
  depcheck: { name: 'depcheck', severity: 'high', via: ['findup-sync', 'js-yaml'] },
});

describe('evaluateAudit', () => {
  it('passes a clean report', () => {
    expect(evaluate(report({}), new Map())).toEqual({ blocking: [], ignored: [], stale: [] });
  });

  it('blocks a high advisory that is not listed', () => {
    const { blocking } = evaluate(bracesTree, new Map());
    expect(blocking).toEqual([
      { id: BRACES, package: 'braces', severity: 'high', title: 'braces is vulnerable' },
    ]);
  });

  it('blocks a critical advisory that is not listed', () => {
    const tree = report({
      handlebars: {
        severity: 'critical',
        via: [advisory('GHSA-aaaa-bbbb-cccc', 'handlebars', 'critical')],
      },
    });
    expect(evaluate(tree, new Map()).blocking.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('lets moderate and low advisories through, as --audit-level=high did', () => {
    const tree = report({
      'sprintf-js': {
        severity: 'moderate',
        via: [advisory('GHSA-1111', 'sprintf-js', 'moderate')],
      },
      ms: { severity: 'low', via: [advisory('GHSA-2222', 'ms', 'low')] },
    });
    expect(evaluate(tree, new Map()).blocking).toEqual([]);
  });

  it('passes the braces tree once the advisory is listed, and says it was skipped', () => {
    const verdict = evaluate(bracesTree, new Map([[BRACES, 'no patched release']]));
    expect(verdict).toEqual({ blocking: [], ignored: [BRACES], stale: [] });
  });

  it('still blocks a second high advisory in a package whose other advisory is listed', () => {
    const tree = report({
      braces: {
        severity: 'high',
        via: [
          advisory(BRACES, 'braces', 'high'),
          advisory('GHSA-new0-new0-new0', 'braces', 'high'),
        ],
      },
    });
    const { blocking } = evaluate(tree, new Map([[BRACES, 'no patched release']]));
    expect(blocking.map((a) => a.id)).toEqual(['GHSA-new0-new0-new0']);
  });

  it('reports a listed advisory that no longer occurs as stale', () => {
    const verdict = evaluate(report({}), new Map([[BRACES, 'no patched release']]));
    expect(verdict.stale).toEqual([BRACES]);
  });

  it('counts an advisory reached through several packages once', () => {
    const shared = advisory('GHSA-dup0-dup0-dup0', 'shared', 'high');
    const tree = report({
      a: { severity: 'high', via: [shared] },
      b: { severity: 'high', via: [shared] },
    });
    expect(evaluate(tree, new Map()).blocking).toHaveLength(1);
  });

  it('blocks a high advisory with no GitHub id, since nothing can be matched against it', () => {
    const tree = report({
      x: { severity: 'high', via: [{ ...advisory('', 'x', 'high'), url: undefined }] },
    });
    expect(evaluate(tree, new Map([['', 'never']])).blocking).toHaveLength(1);
  });

  it('refuses a report it cannot read rather than passing it', () => {
    expect(() => evaluate({ error: { code: 'ENOTFOUND', summary: 'offline' } })).toThrow(/offline/);
    expect(() => evaluate({ auditReportVersion: 1, advisories: {} })).toThrow(
      /auditReportVersion 2/,
    );
    expect(() => evaluate(null)).toThrow(/auditReportVersion 2/);
  });
});

describe('IGNORED_ADVISORIES', () => {
  it('carries exactly the advisories decided on, each with a reason', () => {
    expect([...carried.keys()]).toEqual([BRACES]);
    for (const reason of carried.values()) expect(reason.length).toBeGreaterThan(40);
  });
});
