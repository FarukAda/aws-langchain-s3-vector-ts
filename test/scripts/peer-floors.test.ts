/**
 * What the peer-floor job installs.
 *
 * The job's whole value is that it installs the *lowest* version each declared
 * range admits and runs the type checks and unit tier against it, so a floor
 * that was never published — or that the code cannot work against — fails in
 * CI rather than on the consumer who pinned it. That only holds if the floor
 * is really the floor. The inline shell it replaced silently installed the
 * newest match for a `>=`, an x-range or a `*`, and word-split a `||` union
 * into an install of a package called `||`, leaving the job green having
 * proved nothing.
 *
 * `scripts/` is outside `collectCoverageFrom`, so nothing here moves the
 * coverage gate.
 */
import { describe, expect, it } from '@jest/globals';

// @ts-expect-error — untyped ESM script under scripts/
import { floorOf, peerFloors } from '../../scripts/peer-floors.mjs';

const floor = floorOf as (name: string, range: string) => string;
const floors = peerFloors as (manifest: { peerDependencies?: Record<string, string> }) => string[];

describe('floorOf', () => {
  it.each([
    ['^3.1133.0', '3.1133.0'],
    ['~1.2.3', '1.2.3'],
    ['>=1.0.0', '1.0.0'],
    ['=1.0.0', '1.0.0'],
    ['1.2.3', '1.2.3'],
    ['^1.0.0-rc.1', '1.0.0-rc.1'],
    ['  ^2.0.0  ', '2.0.0'],
  ])('reduces %s to %s', (range, expected) => {
    expect(floor('p', range)).toBe(expected);
  });

  it.each(['1.x', '1.*', '*', 'x', '^1.0.0 || ^2.0.0', '>=1.0.0 <2.0.0', 'latest', ''])(
    'refuses %s rather than guessing',
    (range) => {
      expect(() => floor('p', range)).toThrow(/Cannot determine the floor/);
    },
  );

  it('names the dependency it could not reduce', () => {
    expect(() => floor('@scope/thing', '*')).toThrow(/@scope\/thing/);
  });
});

describe('peerFloors', () => {
  it('produces one npm spec per declared peer, in declaration order', () => {
    expect(floors({ peerDependencies: { b: '^2.0.0', a: '~1.5.0' } })).toEqual([
      'b@2.0.0',
      'a@1.5.0',
    ]);
  });

  it('is empty when nothing is declared', () => {
    expect(floors({})).toEqual([]);
  });

  it('reduces this package’s own declared ranges', async () => {
    // The real manifest, so a range added later that this cannot reduce fails
    // here rather than in a CI job whose failure reads as something else.
    const manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile('package.json', 'utf8'),
    ) as { peerDependencies?: Record<string, string> };
    const specs = floors(manifest);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec).toMatch(/@\d+\.\d+\.\d+/);
  });
});
