import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * What this package is allowed to depend on, enforced on the source.
 *
 * The package declares no runtime dependencies at all: the AWS SDK and
 * `@langchain/core` are peers, installed by the consumer (decision record 1).
 * Anything else in `package.json` is a devDependency, and a devDependency
 * imported from `src/` ships a module the consumer never installed — an
 * import that works in this repository and fails on the first `require` in
 * theirs.
 *
 * Type-only imports are the exception that needs stating rather than
 * assuming: they erase at build time, so one can be correct, but only while
 * it stays type-only and stays out of the emitted declarations.
 */
const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const PACKAGE = JSON.parse(
  readFileSync(
    new URL('../../package.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  ),
) as { peerDependencies: Record<string, string>; dependencies?: Record<string, string> };

interface PermittedImport {
  /** The package specifier, as written. */
  readonly from: string;
  /** Why a devDependency may be named in shipped source. */
  readonly reason: string;
}

/** Packages `src/` may name although the consumer never installs them. */
const PERMITTED_DEV_IMPORTS: readonly PermittedImport[] = [
  {
    from: '@smithy/types',
    reason:
      "`DocumentType` is the shape the SDK's own command input declares for a metadata object, " +
      'and building that input needs the cast. The import is type-only, so it erases at build ' +
      'time and reaches neither the emitted JavaScript nor the declarations — which the tests ' +
      'below check rather than assume. Re-declaring the type here would be a second ' +
      'representation of a shape the SDK owns.',
  },
];

function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

interface ExternalImport {
  readonly file: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/** Every import of a package — not a relative path — that `src/` makes. */
function externalImports(): ExternalImport[] {
  return sourceFiles().flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/^import\s+(type\s+)?[^;]*?from '([^.'][^']*)';/gms)].map((match) => ({
      file: file.slice(SRC.length),
      specifier: match[2]!,
      typeOnly: match[1] !== undefined,
    }));
  });
}

/** `@langchain/core/documents` belongs to `@langchain/core`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

describe('src/ depends on nothing a consumer does not install', () => {
  it('finds the imports to check, so a broken scan cannot pass silently', () => {
    expect(externalImports().length).toBeGreaterThanOrEqual(9);
  });

  it('declares no runtime dependencies, because both real ones are peers', () => {
    expect(PACKAGE.dependencies ?? {}).toEqual({});
  });

  it('imports only from node, a declared peer, or a permitted exception', () => {
    const permitted = new Set(PERMITTED_DEV_IMPORTS.map(({ from }) => from));
    const peers = new Set(Object.keys(PACKAGE.peerDependencies));
    const offenders = externalImports()
      .filter(({ specifier }) => {
        const pkg = packageOf(specifier);
        return !isBuiltin(specifier) && !peers.has(pkg) && !permitted.has(pkg);
      })
      .map(({ file, specifier }) => `${file} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it('keeps every permitted exception type-only, so none of them can reach run time', () => {
    const permitted = new Set(PERMITTED_DEV_IMPORTS.map(({ from }) => from));
    const atRuntime = externalImports()
      .filter(({ specifier, typeOnly }) => permitted.has(packageOf(specifier)) && !typeOnly)
      .map(({ file, specifier }) => `${file} -> ${specifier}`);
    expect(atRuntime).toEqual([]);
  });

  it('keeps no permitted exception that nothing imports any more', () => {
    const imported = new Set(externalImports().map(({ specifier }) => packageOf(specifier)));
    const stale = PERMITTED_DEV_IMPORTS.map(({ from }) => from).filter(
      (from) => !imported.has(from),
    );
    expect(stale).toEqual([]);
  });

  it('states a reason for every permitted exception', () => {
    const unexplained = PERMITTED_DEV_IMPORTS.filter(({ reason }) => reason.trim().length < 80).map(
      ({ from }) => from,
    );
    expect(unexplained).toEqual([]);
  });
});
