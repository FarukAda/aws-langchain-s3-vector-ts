/**
 * Write the two SBOMs a release needs, because `npm sbom` alone cannot
 * describe this package honestly.
 *
 * The shape of the problem: this package has **no** runtime `dependencies`.
 * The two things a consumer must actually install — `@aws-sdk/client-s3vectors`
 * and `@langchain/core` — are `peerDependencies`, and they are present in this
 * repo's tree only because they are also `devDependencies`. So npm resolves
 * them along a dev edge, and `npm sbom --omit=dev` drops both.
 *
 * What it does not drop is five wasm shims (`@emnapi/*`, `@napi-rs/wasm-runtime`,
 * `@tybys/wasm-util`) reached through an optional edge under the dev tooling.
 * The result was a five-component release artifact that omitted everything
 * that matters and listed nothing that does. `--omit=optional` and
 * `--omit=peer` do not change it: all three omit combinations produce the same
 * five components, which is why this script exists rather than another flag.
 *
 * So: two documents, each honest about what it is.
 *
 * 1. `sbom.build.cyclonedx.json` — npm's own output over the whole installed
 *    tree, unmodified. This is what built the tarball: the compiler, the test
 *    runner, the linter and everything under them. It is the document to audit
 *    a build against, and both peers appear in it at the versions the build
 *    resolved.
 *
 * 2. `sbom.runtime.cyclonedx.json` — what a consumer takes on by installing
 *    this package: this package, and the peers it requires at runtime. Derived
 *    from (1) by filtering, never hand-written, so every purl, hash, licence
 *    and external reference is npm's rather than this script's invention.
 *
 * The one fact (1) cannot carry into (2) is that a peer's version in the tree
 * is the version *this build* resolved, not the version a consumer will get.
 * Each peer component therefore carries the declared range as a property, and
 * the document says so in `metadata.properties`, so the runtime SBOM cannot be
 * read as a claim about a consumer's lockfile.
 *
 * Usage: `node scripts/generate-sbom.mjs [outDir]` (default: the repo root).
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? '.';

/** npm exports its own config to child processes; none of it may steer this one. */
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith('npm_config_')),
);

const { peerDependencies = {} } = JSON.parse(readFileSync('package.json', 'utf8'));
const peerNames = Object.keys(peerDependencies);
if (peerNames.length === 0) {
  throw new Error(
    'package.json declares no peerDependencies. This script exists to carry them into the ' +
      'runtime SBOM; with none declared, revisit whether it is still the right shape.',
  );
}

// No --omit: the point of the build document is that nothing is filtered, and
// it is also the only run in which both peers appear at all.
const build = JSON.parse(
  execSync('npm sbom --sbom-format=cyclonedx', {
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString(),
);

const root = build.metadata?.component;
if (!root?.['bom-ref']) {
  throw new Error('npm sbom produced no root component; cannot derive the runtime SBOM from it.');
}

const peers = peerNames.map((name) => {
  const component = build.components?.find((candidate) => candidate.name === name);
  if (!component) {
    throw new Error(
      `Peer dependency "${name}" is declared in package.json but absent from the installed ` +
        'tree, so the runtime SBOM would understate what a consumer needs. Run `npm ci` first.',
    );
  }
  return {
    ...component,
    // The tree's version is this build's resolution. The range is the promise.
    properties: [
      ...(component.properties ?? []),
      { name: 'npm:peerDependency:range', value: peerDependencies[name] },
    ],
  };
});

const runtime = {
  bomFormat: build.bomFormat,
  specVersion: build.specVersion,
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: build.metadata.timestamp,
    lifecycles: [{ phase: 'build' }],
    tools: [
      ...(build.metadata.tools ?? []),
      { name: 'generate-sbom.mjs', vendor: 'this repository' },
    ],
    component: root,
    properties: [
      {
        name: 'sbom:scope',
        value:
          'What installing this package takes on at runtime. This package declares no runtime ' +
          'dependencies; the components listed are its peerDependencies, which the consumer ' +
          'installs and resolves themselves. Each carries npm:peerDependency:range — the ' +
          'declared range — alongside the version this build happened to resolve, which is not ' +
          'a claim about any consumer lockfile. For the toolchain that produced the tarball, ' +
          'see sbom.build.cyclonedx.json.',
      },
    ],
  },
  components: peers,
  dependencies: [
    { ref: root['bom-ref'], dependsOn: peers.map((peer) => peer['bom-ref']) },
    ...peers.map((peer) => ({ ref: peer['bom-ref'], dependsOn: [] })),
  ],
};

const write = (name, document) => {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
};

const buildPath = write('sbom.build.cyclonedx.json', build);
const runtimePath = write('sbom.runtime.cyclonedx.json', runtime);

console.log(`${buildPath}: ${build.components?.length ?? 0} components (full installed tree)`);
console.log(`${runtimePath}: ${peers.length} components (${peerNames.join(', ')})`);
