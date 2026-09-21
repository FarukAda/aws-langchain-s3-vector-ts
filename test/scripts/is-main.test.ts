/**
 * A release script run as a program must do its work, whatever path it was
 * reached by.
 *
 * Each script under `scripts/` is both a module the tests import and a program
 * CI runs, and tells the two apart by asking whether it is the entry point. The
 * question used to be `import.meta.filename === process.argv[1]` — and Node
 * resolves symbolic links in the first and not in the second. Reached through a
 * linked path, a workspace link or a runner's linked checkout, the comparison
 * was false: the script did nothing, and exited 0.
 *
 * For `require-green-ci.mjs` exit 0 *is* the answer — "every required check is
 * present and successful. Publish." A gate that says yes when it has not looked
 * is the failure this whole script exists to prevent.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

// @ts-expect-error — untyped ESM script under scripts/
import { isMain } from '../../scripts/is-main.mjs';

const isEntryPoint = isMain as (moduleUrl: string, entry?: string) => boolean;

const SCRIPTS = resolve('scripts');
let sandbox: string;
let linked: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 's3v-is-main-'));
  linked = join(sandbox, 'scripts-link');
  // A junction on Windows, where it needs no privilege; an ordinary symbolic
  // link everywhere else, where the type is ignored.
  symlinkSync(SCRIPTS, linked, 'junction');
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Run a script as CI does, and report how it exited. */
const run = (path: string, env: Record<string, string>, args: string[] = []): number | null =>
  spawnSync(process.execPath, [path, ...args], { env: { ...process.env, ...env } }).status;

describe('isMain', () => {
  const script = join(SCRIPTS, 'require-green-ci.mjs');
  const moduleUrl = pathToFileURL(script).href;

  it('is true for the path the module lives at', () => {
    expect(isEntryPoint(moduleUrl, script)).toBe(true);
  });

  it('is true for the same file reached through a linked path', () => {
    expect(isEntryPoint(moduleUrl, join(linked, 'require-green-ci.mjs'))).toBe(true);
  });

  it('is false for another file, which is what importing the module looks like', () => {
    expect(isEntryPoint(moduleUrl, join(SCRIPTS, 'peer-floors.mjs'))).toBe(false);
  });

  it('is false when there is no entry point at all', () => {
    expect(isEntryPoint(moduleUrl, undefined)).toBe(false);
  });
});

describe('the release scripts, run through a linked path', () => {
  it('require-green-ci still evaluates: no check runs is "wait" (2), never "publish" (0)', () => {
    expect(run(join(linked, 'require-green-ci.mjs'), { CHECK_RUNS: '' })).toBe(2);
  });

  it('changelog-section still refuses a version that has no section', () => {
    expect(run(join(linked, 'changelog-section.mjs'), {}, ['0.0.0-no-such-version'])).toBe(1);
  });

  it('peer-floors still prints the floors', () => {
    const result = spawnSync(process.execPath, [join(linked, 'peer-floors.mjs')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@aws-sdk/client-s3vectors@');
  });
});
