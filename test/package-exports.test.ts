import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from '@jest/globals';

interface Manifest {
  type: string;
  sideEffects: boolean;
  main: string;
  types: string;
  exports: Record<string, unknown>;
  files: string[];
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as Manifest;

describe('package manifest', () => {
  it('serves ESM to `import` and CommonJS to `require`, each with its own declarations', () => {
    expect(manifest.exports['.']).toEqual({
      import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
      require: { types: './dist/cjs/index.d.ts', default: './dist/cjs/index.js' },
    });
  });

  it('exports package.json for tooling, and nothing else', () => {
    expect(manifest.exports['./package.json']).toBe('./package.json');
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './package.json']);
  });

  it('falls back to the CommonJS build for resolvers that ignore the exports map', () => {
    expect(manifest.main).toBe('./dist/cjs/index.js');
    expect(manifest.types).toBe('./dist/cjs/index.d.ts');
  });

  it('is an ESM package with no import-time side effects', () => {
    expect(manifest.type).toBe('module');
    expect(manifest.sideEffects).toBe(false);
  });

  it('ships only the build output, the licence and the README', () => {
    expect([...manifest.files].sort()).toEqual(['LICENSE', 'README.md', 'dist']);
  });
});
