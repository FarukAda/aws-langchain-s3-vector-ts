/**
 * The release body.
 *
 * The GitHub Release used `generate_release_notes: true`, which produces a
 * list of commit subjects. For a release carrying breaking changes and an
 * "Upgrading from" block, that is the wrong artefact — the thing a reader
 * following the link wants is written in the CHANGELOG. This extracts it, and
 * fails rather than shipping an empty body, because an empty release body is
 * the failure that nobody notices until someone needs it.
 *
 * `scripts/` is outside `collectCoverageFrom`, so nothing here moves the
 * coverage gate.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from '@jest/globals';

// @ts-expect-error — untyped ESM script under scripts/
import { sectionFor } from '../../scripts/changelog-section.mjs';

const section = sectionFor as (changelog: string, version: string) => string | undefined;

const CHANGELOG = [
  '# Changelog',
  '',
  'Preamble that belongs to no release.',
  '',
  '## [Unreleased]',
  '',
  '### Fixed',
  '',
  '- something not yet released',
  '',
  '## [1.2.0] - 2026-09-20',
  '',
  '### Breaking',
  '',
  '- a break worth reading',
  '',
  '### Added',
  '',
  '- an addition',
  '',
  '## [1.1.0] - 2026-08-01',
  '',
  '- older',
  '',
  '[Unreleased]: https://example.invalid/compare/v1.2.0...HEAD',
  '[1.2.0]: https://example.invalid/compare/v1.1.0...v1.2.0',
].join('\n');

describe('sectionFor', () => {
  it('returns the whole of one release section', () => {
    expect(section(CHANGELOG, '1.2.0')).toBe(
      ['### Breaking', '', '- a break worth reading', '', '### Added', '', '- an addition'].join(
        '\n',
      ),
    );
  });

  it('stops at the next release rather than running on', () => {
    expect(section(CHANGELOG, '1.2.0')).not.toContain('older');
  });

  it('stops before the link-reference footer', () => {
    // The last section in the file has no `## ` after it, only the link refs.
    expect(section(CHANGELOG, '1.1.0')).toBe('- older');
    expect(section(CHANGELOG, '1.1.0')).not.toContain('https://example.invalid');
  });

  it('reads [Unreleased] like any other heading', () => {
    expect(section(CHANGELOG, 'Unreleased')).toContain('something not yet released');
  });

  it('is undefined for a version with no section', () => {
    expect(section(CHANGELOG, '9.9.9')).toBeUndefined();
  });

  it('is undefined for a section that exists but is empty', () => {
    expect(
      section('# Changelog\n\n## [1.0.0] - 2026-01-01\n\n## [0.9.0]\n', '1.0.0'),
    ).toBeUndefined();
  });

  it('does not match a different version that shares a prefix', () => {
    const doc =
      '## [1.0.0-rc.3] - 2026-09-20\n\n- rc three\n\n## [1.0.0] - 2026-10-01\n\n- stable\n';
    expect(section(doc, '1.0.0')).toBe('- stable');
    expect(section(doc, '1.0.0-rc.3')).toBe('- rc three');
  });

  it('extracts this package’s own current release section', () => {
    // The real file, so a restructuring that breaks extraction fails here
    // rather than producing an empty GitHub Release.
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const body = section(readFileSync('CHANGELOG.md', 'utf8'), version);
    expect(body).toBeDefined();
    expect(body!.length).toBeGreaterThan(200);
  });
});
