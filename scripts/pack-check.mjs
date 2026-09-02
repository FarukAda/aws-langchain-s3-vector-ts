/**
 * Assert the tarball `npm pack` would publish has exactly the shipped shape:
 * an ESM tree and a CommonJS tree under dist/, the CommonJS scope marker, the
 * licence, the README and the manifest. JavaScript source maps ship (they
 * inline the TypeScript source, so stack traces land on .ts lines);
 * declaration maps do not, because they point at src/, which is not in the
 * tarball. Anything else (tests, configs, a stale flat dist/ from an older
 * build layout) is a packaging regression.
 */
import { execSync } from 'node:child_process';

const [{ files }] = JSON.parse(
  execSync('npm pack --dry-run --json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
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
