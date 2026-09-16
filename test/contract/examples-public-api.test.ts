import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The verification scripts use only the public API.
 *
 * `examples/verify-search.mjs` called `store._selectRelevanceScoreFn()`. When
 * the store's internals became `#private`, that method stopped existing, and the
 * script crashed with a `TypeError` two-thirds of the way through a live run —
 * after which `npm run verify` stopped, so `verify-edge-cases.mjs` never ran at
 * all. Nothing noticed: the scripts are plain `.mjs`, outside lint, outside
 * every typecheck, and outside CI, because they need AWS credentials and
 * Bedrock access.
 *
 * They cannot be type-checked cheaply, but the shape of that mistake can be
 * seen without running them. Every internal of the store is a `#private` member
 * now, so no underscore-prefixed member is part of the surface a script may
 * reach — an `._name` access in an example is either a reference to something
 * that no longer exists or a dependency on something that should not be public.
 */
const EXAMPLES = new URL('../../examples/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

/** Script source with comments removed, so prose about a member is not a use of it. */
function code(file: string): string {
  return readFileSync(join(EXAMPLES, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const scripts = readdirSync(EXAMPLES).filter((file) => file.endsWith('.mjs'));

describe('the verification scripts use only the public API', () => {
  it('finds the scripts, so an empty scan cannot pass', () => {
    expect(scripts).toEqual(
      expect.arrayContaining(['verify-core.mjs', 'verify-search.mjs', 'verify-edge-cases.mjs']),
    );
  });

  it.each(scripts.map((file) => [file] as const))('%s reaches no underscore member', (file) => {
    const accesses = [...code(file).matchAll(/\.(_[A-Za-z]\w*)\b/g)].map((match) => match[1]);
    expect(accesses).toEqual([]);
  });
});
