/**
 * Print one release's section of the CHANGELOG, for the GitHub Release body.
 *
 * The release used `generate_release_notes: true`, which produces a list of
 * commits and pull requests. For a `1.0.0` arriving after thirteen versions and
 * a breaking rename, that is the wrong artefact: the migration guidance, the
 * list of what breaks and the "Upgrading from 0.9.0" block all live in the
 * CHANGELOG, and a reader who follows a release link wants those rather than a
 * list of commit subjects.
 *
 * Usage: `node scripts/changelog-section.mjs 1.0.0-rc.3`
 *
 * Exits non-zero if the version has no section, so a release cannot quietly
 * ship an empty body.
 */
import { readFileSync } from 'node:fs';

/** `## [1.0.0-rc.3] - 2026-09-20`, and the same without a date. */
const headingFor = (version) =>
  new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\]`, 'm');

/**
 * The body of `version`'s section: everything after its heading, up to the
 * next `## ` heading or the link-reference footer, whichever comes first.
 */
export function sectionFor(changelog, version) {
  const lines = changelog.split('\n');
  const heading = headingFor(version);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? undefined : body;
}

if (import.meta.filename === process.argv[1]) {
  const version = process.argv[2];
  if (version === undefined || version === '') {
    console.error('usage: node scripts/changelog-section.mjs <version>');
    process.exit(2);
  }
  const body = sectionFor(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (body === undefined) {
    console.error(
      `::error::CHANGELOG.md has no section for ${version}. The release body would be empty; ` +
        'add the section, or rename `## [Unreleased]` to this version.',
    );
    process.exit(1);
  }
  process.stdout.write(`${body}\n`);
}
