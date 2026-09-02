/**
 * Package smoke test: build, `npm pack`, install the tarball into a clean
 * temporary project with the peers at their declared ranges, and use the
 * published surface the way a consumer does: `import` from ESM, `require`
 * from CommonJS, and a type-check of both consumer flavours against the
 * shipped declarations with the oldest supported TypeScript major and
 * `skipLibCheck` off. This is the only check that exercises the `exports`
 * map, the `files` allow-list and the nested CommonJS scope as a consumer
 * sees them rather than as the repo's own TypeScript program does. Needs the
 * network (npm install); run via `npm run test:package-smoke`.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const PACKAGE = '@farukada/aws-langchain-s3-vector-ts';

/** Every peer at its declared range, read from package.json so a new peer is covered the moment it is declared. */
const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const PEERS = Object.entries(manifest.peerDependencies).map(([name, range]) => `"${name}@${range}"`);

/** The oldest TypeScript major the shipped declarations support, plus Node types for the consumer. */
const TYPECHECK_DEPS = ['typescript@5', '@types/node'];

/** Shared by both module systems: the surface is there, and an offline code path behaves. */
const ASSERTIONS = `
  for (const fn of [AmazonS3Vectors, S3VectorsError, isS3VectorsError, cosineRelevanceScoreFn, euclideanRelevanceScoreFn]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(S3VectorsErrorCode.VALIDATION, 'VALIDATION');
  const store = new AmazonS3Vectors(undefined, { vectorBucketName: 'smoke', indexName: 'smoke' });
  await assert.rejects(
    () => store.delete({}),
    (error) => isS3VectorsError(error) && error.code === S3VectorsErrorCode.VALIDATION,
  );
`;

const RUN_ESM = `
import assert from 'node:assert/strict';
import {
  AmazonS3Vectors, S3VectorsError, isS3VectorsError, S3VectorsErrorCode,
  cosineRelevanceScoreFn, euclideanRelevanceScoreFn,
} from '${PACKAGE}';
${ASSERTIONS}
console.log('SMOKE_ESM_OK');
`;

const RUN_CJS = `
const assert = require('node:assert/strict');
const { sep } = require('node:path');
const {
  AmazonS3Vectors, S3VectorsError, isS3VectorsError, S3VectorsErrorCode,
  cosineRelevanceScoreFn, euclideanRelevanceScoreFn,
} = require('${PACKAGE}');
const { version } = require('${PACKAGE}/package.json');
assert.equal(typeof version, 'string');
// A CommonJS consumer must get the CommonJS build, not an ES module that
// only loads because this particular Node happens to support require(esm).
const resolved = require.resolve('${PACKAGE}').split(sep).join('/');
assert.ok(resolved.endsWith('/dist/cjs/index.js'), 'require() resolved to ' + resolved);
(async () => {${ASSERTIONS}
  console.log('SMOKE_CJS_OK');
})().catch((error) => { console.error(error); process.exit(1); });
`;

/** A consumer that names the public types; type-checked once as .mts and once as .cts. */
const CONSUMER = `
import { AmazonS3Vectors, isS3VectorsError } from '${PACKAGE}';
import type { AmazonS3VectorsConfig, DistanceMetric } from '${PACKAGE}';

const distanceMetric: DistanceMetric = 'cosine';
export const config: AmazonS3VectorsConfig = { vectorBucketName: 'b', indexName: 'i', distanceMetric };
export const store = new AmazonS3Vectors(undefined, config);
export const guard: (value: unknown) => boolean = isS3VectorsError;
`;

/** Runs a command, streaming stderr so a failure is readable, and returns stdout. */
const run = (command, cwd) =>
  execSync(command, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

/**
 * The tsc diagnostics that point at this package's declarations or at the
 * consumer files. Diagnostics inside a peer's own declarations are not this
 * package's to fix and are filtered out; a tsc run that fails without any
 * diagnostics at all (no compiler, a bad flag) is an error here, never a pass.
 */
function ourTypeErrors(dir) {
  assert.match(run('npx tsc --version', dir), /^Version 5\./);
  const command =
    'npx tsc --noEmit --strict --skipLibCheck false --module nodenext --moduleResolution nodenext ' +
    '--target es2022 --types node consumer.mts consumer.cts';
  try {
    execSync(command, { cwd: dir, stdio: 'pipe' });
    return [];
  } catch (error) {
    const output = error.stdout ? error.stdout.toString() : '';
    const diagnostics = output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
    assert.ok(diagnostics.length > 0, `tsc failed without diagnostics:\n${output}\n${error.stderr ?? ''}`);
    return diagnostics.filter((line) =>
      /aws-langchain-s3-vector-ts[\\/]dist|^consumer\.[mc]ts/.test(line),
    );
  }
}

test(
  'packs, installs the tarball, and uses the published surface from ESM, CommonJS and TypeScript',
  { timeout: 600000 },
  () => {
    const root = process.cwd();
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
    const tarball = execSync('npm pack --silent', { cwd: root }).toString().trim().split(/\s+/).pop();
    const tarballPath = join(root, tarball);
    const dir = mkdtempSync(join(tmpdir(), 's3v-smoke-'));
    try {
      execSync('npm init -y', { cwd: dir, stdio: 'ignore' });
      execSync(`npm install "${tarballPath}" ${PEERS.join(' ')} ${TYPECHECK_DEPS.join(' ')}`, {
        cwd: dir,
        stdio: 'ignore',
      });
      writeFileSync(join(dir, 'run.mjs'), RUN_ESM);
      assert.match(run('node run.mjs', dir), /SMOKE_ESM_OK/);
      writeFileSync(join(dir, 'run.cjs'), RUN_CJS);
      assert.match(run('node run.cjs', dir), /SMOKE_CJS_OK/);
      writeFileSync(join(dir, 'consumer.mts'), CONSUMER);
      writeFileSync(join(dir, 'consumer.cts'), CONSUMER);
      assert.deepEqual(ourTypeErrors(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(tarballPath, { force: true });
    }
  },
);

test(
  'pack:check passes with npm dry-run config inherited from a publish',
  { timeout: 600000 },
  () => {
    // `npm publish --dry-run` exports npm_config_dry_run=true to every
    // lifecycle script it runs, and prepublishOnly runs pack:check. Anything
    // inside that shells out to `npm pack` inherits the flag, gets no tarball
    // written, and fails on a file that does not exist — which is exactly how
    // the first v1.0.0-rc.1 release run died, at the dry-run step, before
    // publishing. Reproduce that environment and require the check to pass.
    const root = process.cwd();
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
    const output = execSync('npm run pack:check', {
      cwd: root,
      env: { ...process.env, npm_config_dry_run: 'true' },
      stdio: ['ignore', 'pipe', 'inherit'],
    }).toString();
    assert.match(output, /pack listing ok/);
    assert.match(output, /No problems found/);
  },
);
