/**
 * `npm audit --audit-level=high`, less the advisories listed below.
 *
 * `npm audit` cannot leave out one advisory: `--audit-level` is its only
 * filter. An advisory with no patched release then holds CI and the release
 * red until upstream acts, and the only way out it offers is lowering the bar
 * for every advisory at once. This keeps the bar at high and carries each
 * exception by its GHSA id, with the reason written next to it, so an unlisted
 * advisory — including a second one in the same package — still fails.
 *
 * A listed advisory that no longer occurs is reported as a warning, so the
 * exception is removed once it has served its purpose.
 */
import { spawnSync } from 'node:child_process';

import { isMain } from './is-main.mjs';

/** GHSA id → why it is carried. Keep this list as short as it can be. */
export const IGNORED_ADVISORIES = new Map([
  [
    'GHSA-vfj7-8cjw-p6xm',
    'braces <= 3.0.3, stack-exhaustion denial of service on deeply nested patterns. ' +
      'No patched release (advisory of 2026-09-18). Reached only through the ' +
      'development tool depcheck (findup-sync -> micromatch -> braces), which runs on ' +
      "this repository's own files; nothing of it ships in the package. Remove this " +
      'entry when braces or micromatch publishes a fix.',
  ],
]);

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/** The GHSA id at the end of an advisory URL, or `''` when there is none. */
const advisoryId = (url) => (typeof url === 'string' ? (url.split('/').pop() ?? '') : '');

/**
 * Accepts: a parsed `npm audit --json` report, and the advisories to carry.
 *
 * Returns: `blocking`, every distinct high or critical advisory not carried;
 * `ignored`, the carried ids that occurred; `stale`, the carried ids that did
 * not. Only advisory objects are judged. A package whose `via` names another
 * package is reached through that package's advisory, which is judged there.
 *
 * Throws: for a report this cannot read — npm's own error, or any shape other
 * than auditReportVersion 2. A report not understood is not a clean one.
 */
export function evaluateAudit(report, ignored = IGNORED_ADVISORIES) {
  if (report?.error !== undefined) {
    throw new Error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  }
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') {
    throw new Error('expected an npm audit --json report with auditReportVersion 2');
  }

  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING_SEVERITIES.has(via.severity)) continue;
      const id = advisoryId(via.url);
      const key = id === '' ? `${via.name}:${via.title}` : id;
      if (found.has(key)) continue;
      found.set(key, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }

  const advisories = [...found.values()];
  const isCarried = (advisory) => advisory.id !== '' && ignored.has(advisory.id);
  const seen = new Set(advisories.filter(isCarried).map((advisory) => advisory.id));
  return {
    blocking: advisories.filter((advisory) => !isCarried(advisory)),
    ignored: [...seen],
    stale: [...ignored.keys()].filter((id) => !seen.has(id)),
  };
}

// The entry point. `scripts/` is outside the coverage scope, so this is not
// instrumented; `evaluateAudit` above is what the tests exercise.
if (isMain(import.meta.url)) {
  // npm audit exits 1 whenever it finds anything, so its status says nothing
  // here; the report does. Through a shell, as one fixed string, because npm
  // is npm.cmd on Windows.
  const audit = spawnSync('npm audit --json', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  });
  if (audit.error !== undefined) throw audit.error;

  const { blocking, ignored, stale } = evaluateAudit(JSON.parse(audit.stdout));

  for (const id of ignored)
    console.log(`Carried, not failing: ${id} — ${IGNORED_ADVISORIES.get(id)}`);
  for (const id of stale) {
    console.log(`::warning::${id} is listed in scripts/audit.mjs but no longer occurs; remove it.`);
  }
  if (blocking.length > 0) {
    for (const { id, package: name, severity, title } of blocking) {
      console.error(`  ${severity} ${name}: ${title} (${id || 'no advisory id'})`);
    }
    console.error('::error::npm audit found a high or critical advisory that is not carried.');
    process.exit(1);
  }
  console.log('npm audit: no high or critical advisory beyond those carried.');
}
