import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from '@jest/globals';

import { classifyAwsError } from '../../src/shared/errors/classify.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * The citations name a version, a file and a line. All three have to be true of
 * the dependency that is actually installed, or a citation is decoration.
 *
 * This is the drift a dependency bump causes: the facts behind `classifyAwsError`,
 * the metric check and the retriever's signal were read out of a specific
 * version of `@aws-sdk/client-s3vectors` and `@langchain/core`, and nothing
 * re-read them when those packages moved. A line number that has shifted, a
 * file that has been renamed or a version that no longer exists all fail here.
 */
const ROOT = new URL('../../', import.meta.url);

/** Every `.ts` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The version of an installed package, read from its own manifest. */
function installedVersion(pkg: string): string {
  const manifest = fileURLToPath(new URL(`node_modules/${pkg}/package.json`, ROOT));
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

interface Citation {
  readonly file: string;
  readonly pkg: string;
  readonly version: string;
  /** The path inside the package, if the citation names one. */
  readonly path: string | undefined;
  /** Every line the citation names for that path — `:81`, `:85`. */
  readonly lines: number[];
}

/**
 * A citation looks like:
 *
 *     (`@langchain/core@1.2.11` `dist/retrievers/index.js:81`, `:85`)
 *
 * The package and version are required; the path and its line numbers are read
 * when they are there, because not every fact is at a line.
 */
const CITATION =
  /`(@[\w/.-]+|[\w.-]+)@(\d+\.\d+\.\d+)`(?:[\s*]*`([\w./-]+)(?::(\d+))?`((?:,?[\s*]*`:\d+`)*))?/g;

function citationsIn(file: string): Citation[] {
  const text = readFileSync(file, 'utf8');
  const found: Citation[] = [];
  for (const match of text.matchAll(CITATION)) {
    const [, pkg, version, path, firstLine, extraLines] = match;
    const lines = [
      ...(firstLine === undefined ? [] : [Number(firstLine)]),
      ...[...(extraLines ?? '').matchAll(/`:(\d+)`/g)].map((m) => Number(m[1])),
    ];
    found.push({ file, pkg: pkg!, version: version!, path, lines });
  }
  return found;
}

const CITATIONS = [
  ...sourceFiles(fileURLToPath(new URL('src', ROOT))),
  ...sourceFiles(fileURLToPath(new URL('test', ROOT))),
].flatMap(citationsIn);

describe('every dependency citation is about the dependency that is installed', () => {
  it('finds the citations at all, so an empty scan cannot pass', () => {
    // Both packages are cited; the count is a floor, not an exact number, so
    // adding a citation does not fail this.
    expect(CITATIONS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CITATIONS.map((c) => c.pkg))).toEqual(
      new Set(['@aws-sdk/client-s3vectors', '@langchain/core']),
    );
  });

  it.each(CITATIONS.map((c) => [`${c.pkg}@${c.version} ${c.path ?? '(no file)'}`, c] as const))(
    '%s is installed at the version it names',
    (_label, citation) => {
      expect(citation.version).toBe(installedVersion(citation.pkg));
    },
  );

  it.each(
    CITATIONS.filter((c) => c.path !== undefined).map((c) => [`${c.pkg} ${c.path!}`, c] as const),
  )('%s exists in the installed package', (_label, citation) => {
    const target = fileURLToPath(new URL(`node_modules/${citation.pkg}/${citation.path!}`, ROOT));
    const contents = readFileSync(target, 'utf8').split('\n');
    for (const line of citation.lines) {
      // A cited line must exist and carry code: a citation that has slid off
      // the end of a file, or onto a blank line, is no longer evidence.
      expect(contents.length).toBeGreaterThanOrEqual(line);
      expect(contents[line - 1]!.trim()).not.toBe('');
    }
  });
});

describe('the error classifier keeps pace with the service model', () => {
  // `classifyAwsError` maps exception names to codes. The names are literal
  // types on the exception classes the SDK declares, so the model itself says
  // whether the map is complete — a new exception in a later SDK would
  // otherwise be classified as a generic request failure with nothing failing.
  const errors = readFileSync(
    fileURLToPath(
      new URL('node_modules/@aws-sdk/client-s3vectors/dist-types/models/errors.d.ts', ROOT),
    ),
    'utf8',
  );
  const declared = [...errors.matchAll(/readonly name: "(\w+)"/g)].map((m) => m[1]!);

  it('reads the names out of the model, so an empty scan cannot pass', () => {
    expect(declared.length).toBeGreaterThanOrEqual(13);
    expect(declared).toContain('ValidationException');
  });

  it.each(declared)('%s is classified as something other than the catch-all', (name) => {
    const error = Object.assign(new Error(`synthetic ${name}`), { name });
    expect(classifyAwsError(error)).not.toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });
});
