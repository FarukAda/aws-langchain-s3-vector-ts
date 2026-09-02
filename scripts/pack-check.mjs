/**
 * Assert the tarball `npm pack` would publish has exactly the shipped shape,
 * then hand a real tarball to arethetypeswrong. Two checks in one script:
 *
 * 1. The listing: an ESM tree and a CommonJS tree under dist/, the CommonJS
 *    scope marker, the licence, the README and the manifest. JavaScript
 *    source maps ship (they inline the TypeScript source, so stack traces
 *    land on .ts lines); declaration maps do not, because they point at
 *    src/, which is not in the tarball. Anything else (tests, configs, a
 *    stale flat dist/ from an older build layout) is a packaging regression.
 *
 * 2. Resolution: arethetypeswrong over a tarball this script packs itself,
 *    into a temporary directory, with a clean npm environment. It used to
 *    run `attw --pack .`, which shells out to `npm pack` on its own — and
 *    under `npm publish --dry-run`, which exports npm_config_dry_run=true to
 *    every lifecycle script, that nested pack wrote nothing and attw failed
 *    on a file that did not exist. That is how the first v1.0.0-rc.1 release
 *    run died, at the dry-run step. Packing here with the flag scrubbed and
 *    `--no-dry-run` stated makes the check independent of who invoked it.
 *    (The `attw` binary is called from here rather than from an npm script
 *    line, which depcheck cannot see through; `@arethetypeswrong/cli` is
 *    therefore listed in .depcheckrc.)
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** npm exports its own config to child processes as npm_config_*; none of it may leak into our packs. */
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith('npm_config_')),
);

const [{ files }] = JSON.parse(
  execSync('npm pack --dry-run --json', { env: cleanEnv, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
);
const paths = files.map((file) => file.path).sort();

const allowed = (path) =>
  path.startsWith('dist/esm/') ||
  path.startsWith('dist/cjs/') ||
  ['LICENSE', 'README.md', 'package.json'].includes(path);
const unexpected = paths.filter((path) => !allowed(path) || path.endsWith('.d.ts.map'));

const required = [
  'dist/esm/index.js',
  'dist/esm/index.d.ts',
  'dist/cjs/index.js',
  'dist/cjs/index.d.ts',
  'dist/cjs/package.json',
  'LICENSE',
  'README.md',
  'package.json',
];
const missing = required.filter((path) => !paths.includes(path));

if (unexpected.length > 0 || missing.length > 0) {
  console.error(
    `pack listing: unexpected ${JSON.stringify(unexpected)} missing ${JSON.stringify(missing)}`,
  );
  process.exit(1);
}
console.log(
  `pack listing ok: ${paths.length} files under dist/esm and dist/cjs, plus LICENSE, README.md and package.json`,
);

const dir = mkdtempSync(join(tmpdir(), 's3v-pack-check-'));
try {
  const [{ filename }] = JSON.parse(
    execSync(`npm pack --no-dry-run --json --pack-destination "${dir}"`, {
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString(),
  );
  execSync(`attw "${join(dir, filename)}" --profile node16`, { env: cleanEnv, stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
