import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The permitted import direction between the layers of `src/`, enforced on the
 * source itself.
 *
 * A decomposition only survives if the direction of its dependencies is
 * checked by something other than care. Four upward imports had already
 * accumulated here — three of them moving a pure scope type up out of
 * `internal/` so that `shared/` could name it — and every one of them was
 * `import type`, which erases at run time and therefore leaves no cycle, no
 * failing test and nothing for a reviewer to notice. They were found by
 * drawing the graph by hand.
 *
 * This is that drawing, as a gate. The table below *is* the rule: a layer may
 * import from itself or from any layer earlier in the list, and nothing else.
 * Adding a directory or a top-level module to `src/` without placing it in the
 * table fails too, so a new module cannot escape the rule by being unlisted.
 */
const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * The layers of `src/`, innermost first. A module may import from its own
 * layer or from any layer before it in this list.
 *
 * - `leaf` — declarations and pure functions that import nothing from `src/`.
 * - `shared` — utilities with no knowledge of an operation: errors, metadata,
 *   describing a value, the byte and length limits AWS publishes.
 * - `internal` — the mechanics of one AWS call or one cross-cutting concern:
 *   pagination, batching, rate limiting, signals, the index lifecycle.
 * - `actions` — one public operation each, assembled from `internal`.
 * - `store` — the classes a caller holds, which own the client and the config.
 * - `entry` — the published surface, which only re-exports.
 */
const LAYERS = ['leaf', 'shared', 'internal', 'actions', 'store', 'entry'] as const;

type Layer = (typeof LAYERS)[number];

/** The layer each directory directly under `src/` belongs to. */
const DIRECTORY_LAYERS: Readonly<Record<string, Layer>> = {
  shared: 'shared',
  internal: 'internal',
  actions: 'actions',
};

/** The layer each module sitting directly in `src/` belongs to. */
const ROOT_MODULE_LAYERS: Readonly<Record<string, Layer>> = {
  'types.ts': 'leaf',
  'relevance-scores.ts': 'leaf',
  's3-vectors.ts': 'store',
  'retriever.ts': 'store',
  'index.ts': 'entry',
};

interface PermittedImport {
  /** The importing module, relative to `src/`. */
  readonly from: string;
  /** The module it reaches up to, relative to `src/`. */
  readonly to: string;
  /** Why this one is permitted, and what removing it would cost. */
  readonly reason: string;
}

/**
 * The upward imports this package accepts, each with the reason it is not
 * simply a violation that nobody has fixed.
 *
 * An entry that no longer corresponds to a real import fails the suite, so the
 * list can only shrink by accident — never grow.
 */
const PERMITTED_UPWARD_IMPORTS: readonly PermittedImport[] = [
  {
    from: 'shared/errors/s3-vectors-error.ts',
    to: 's3-vectors.ts',
    reason:
      '`S3VectorsErrorContext.instance` is the store instance a failed write ran against, and ' +
      'it is published API: a caller recovers with ' +
      '`error.context.instance.delete({ ids: writtenIds })`. Typing it as anything narrower ' +
      'than `AmazonS3Vectors` would hide methods the caller already holds, which is the false ' +
      'abstraction the guidelines name rather than a simplification. The import is type-only, ' +
      'so no part of the store reaches the error at run time and the cycle exists only in the ' +
      'type graph. Removing this entry means changing that published type.',
  },
];

/** Every `.ts` file under `src/`, as a path relative to `src/` with `/` separators. */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [relative(SRC, path).split(sep).join('/')] : [];
  });
}

/** The layer a module belongs to, or `undefined` when the table does not place it. */
function layerOf(file: string): Layer | undefined {
  const slash = file.indexOf('/');
  return slash === -1 ? ROOT_MODULE_LAYERS[file] : DIRECTORY_LAYERS[file.slice(0, slash)];
}

interface Edge {
  readonly from: string;
  readonly to: string;
}

/**
 * Every import and re-export within `src/`, both ends relative to `src/`.
 *
 * Comments are stripped first: several contracts here quote an import
 * specifier while explaining why a module does *not* reach for it, and a
 * scanner that counts prose finds edges that do not exist.
 */
function edges(): Edge[] {
  return sourceFiles().flatMap((file) => {
    const text = readFileSync(join(SRC, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return [...text.matchAll(/\bfrom '(\.[^']+)'/g)].map((match) => {
      const target = resolve(dirname(join(SRC, file)), match[1]!).replace(/\.js$/, '.ts');
      return { from: file, to: relative(SRC, target).split(sep).join('/') };
    });
  });
}

describe('the import direction between layers holds', () => {
  it('finds the imports to check, so a broken scan cannot pass silently', () => {
    // 222 at the time of writing. The floor only guards against the scan going
    // blind — a regex that stops matching would otherwise report a clean graph.
    expect(edges().length).toBeGreaterThanOrEqual(200);
  });

  it('places every module of src/ in a layer', () => {
    const unplaced = sourceFiles().filter((file) => layerOf(file) === undefined);
    expect(unplaced).toEqual([]);
  });

  it('resolves every import to a module of src/', () => {
    const unresolved = edges()
      .filter(({ to }) => layerOf(to) === undefined)
      .map(({ from, to }) => `${from} -> ${to}`);
    expect(unresolved).toEqual([]);
  });

  it('lets no module import from a layer above its own', () => {
    const permitted = new Set(PERMITTED_UPWARD_IMPORTS.map(({ from, to }) => `${from} -> ${to}`));
    const violations = edges()
      .filter(({ from, to }) => LAYERS.indexOf(layerOf(to)!) > LAYERS.indexOf(layerOf(from)!))
      .filter(({ from, to }) => !permitted.has(`${from} -> ${to}`))
      .map(({ from, to }) => `${layerOf(from)!} ${from} -> ${layerOf(to)!} ${to}`);
    expect(violations).toEqual([]);
  });

  it('keeps no permitted exception that no longer describes a real import', () => {
    const present = new Set(edges().map(({ from, to }) => `${from} -> ${to}`));
    const stale = PERMITTED_UPWARD_IMPORTS.map(({ from, to }) => `${from} -> ${to}`).filter(
      (edge) => !present.has(edge),
    );
    expect(stale).toEqual([]);
  });

  it('states a reason for every permitted exception', () => {
    const unexplained = PERMITTED_UPWARD_IMPORTS.filter(
      ({ reason }) => reason.trim().length < 80,
    ).map(({ from, to }) => `${from} -> ${to}`);
    expect(unexplained).toEqual([]);
  });
});
