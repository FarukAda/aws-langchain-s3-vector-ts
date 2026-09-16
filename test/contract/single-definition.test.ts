import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * Nothing shared is defined twice, and nothing shared is shadowed.
 *
 * `jscpd` reports zero clones on this package and always did, because the
 * duplication here was never the kind a clone detector sees: single-line
 * constants, in different files, under names that do not match. `MAX_TOP_K`
 * lived in `guards.ts` and `mmr.ts`; the dimension bounds in `limits.ts` and
 * `index-lifecycle.ts`; the metadata-key length as `METADATA_KEY_MAX_LENGTH` in
 * one file and `NON_FILTERABLE_KEY_MAX` in another; the tag bounds twice over.
 * Every copy agreed, so nothing failed — and nothing would have failed if one
 * had been changed and the others left behind.
 *
 * The plain-object helper was worse, because the copies did *not* agree. Four
 * functions called `isPlainObject`: two rejecting `Date` and class instances by
 * walking the prototype chain, two accepting anything that was not an array. A
 * call site said `isPlainObject` and meant whichever one its own file happened
 * to define, and no reader could tell which without looking.
 *
 * These are the two checks that would have caught both.
 */
const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Top-level `const NAME =` and `function NAME(` declarations, by file. */
function declarationsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^(?:export )?(?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map(
    (m) => m[1] as string,
  );
}

const files = sourceFiles(SRC);
const relative = (file: string): string => file.slice(SRC.length).replace(/\\/g, '/');

/** Where each top-level name is declared. */
const declaredIn = new Map<string, string[]>();
for (const file of files) {
  for (const name of declarationsIn(file)) {
    declaredIn.set(name, [...(declaredIn.get(name) ?? []), relative(file)]);
  }
}

describe('a shared limit is stated once', () => {
  const sharedLimits = declarationsIn(join(SRC, 'shared/aws-limits.ts'));

  it('exports the limits it is meant to, so an empty scan cannot pass', () => {
    expect(sharedLimits).toContain('MAX_TOP_K');
    expect(sharedLimits).toContain('MAX_DIMENSION');
    expect(sharedLimits.length).toBeGreaterThan(5);
  });

  it.each(sharedLimits.map((name) => [name] as const))(
    '%s is declared only in shared/aws-limits.ts',
    (name) => {
      expect(declaredIn.get(name)).toEqual(['shared/aws-limits.ts']);
    },
  );
});

describe('the two object checks are one module and two names', () => {
  it('declares isPlainObject and isObjectLike only in shared/objects.ts', () => {
    expect(declaredIn.get('isPlainObject')).toEqual(['shared/objects.ts']);
    expect(declaredIn.get('isObjectLike')).toEqual(['shared/objects.ts']);
  });

  it('declares no other name that reads as a plain-object check', () => {
    // A near-miss name — `isPlainObjectValue`, say — is how the fourth copy got
    // in: it did not collide, so nothing complained.
    const lookalikes = [...declaredIn.keys()].filter(
      (name) => /plainobject/i.test(name) && name !== 'isPlainObject',
    );
    expect(lookalikes).toEqual([]);
  });
});
