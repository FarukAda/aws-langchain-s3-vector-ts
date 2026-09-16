import { readFileSync } from 'node:fs';

import { describe, it, expect } from '@jest/globals';

/**
 * A documented signature shows each parameter as required or optional the way
 * the code does.
 *
 * The name checks in `documented-api.test.ts` cannot see this, and neither can
 * `check:docs`: a table row is prose, not a compiled sample, so
 * `similaritySearchVectorWithScore(vector, k?, …)` sat in the README's API
 * table with a `k` that is required — a reader following the table writes a
 * call the compiler rejects. The guide had the same defect in the other
 * direction on three rows, showing a required `k` that defaults to `4`.
 *
 * Both were invisible for the same reason: the signature lives in one file and
 * its description in another, and nothing read them together.
 *
 * Names are deliberately not compared. Docs may shorten `documents` to `docs`,
 * and that is not drift. What the reader acts on is the arity and which
 * arguments they may leave out, so that is what this asserts.
 */
const DOCS = ['README.md', 'src/guide.md'] as const;

const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/**
 * Split a parameter list on commas that are not inside brackets.
 *
 * A parameter's type can carry its own commas — `Record<string, unknown>[]` in
 * `fromTexts` — so a plain `split(',')` reports the wrong arity.
 */
function splitParameters(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if ('([{<'.includes(char)) depth += 1;
    else if (')]}>'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** The text between the parentheses opening at `open`. */
function parameterList(text: string, open: number): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
}

/**
 * Which parameters of each method on the store may be omitted.
 *
 * Optional means what a caller experiences as optional: `name?` or a default.
 * The `?` must follow the parameter *name* — `config: Config & { ids?: … }` is
 * a required parameter whose type happens to contain an optional property.
 */
function signatures(): Map<string, boolean[]> {
  const source = read('src/s3-vectors.ts');
  const found = new Map<string, boolean[]>();
  for (const match of source.matchAll(/^ {2}(?:(?:static|override|async) )*(\w+)\(/gm)) {
    const name = match[1] as string;
    if (name === 'constructor') continue;
    const list = parameterList(source, match[0].length + match.index - 1);
    if (list === undefined) continue;
    found.set(
      name,
      splitParameters(list).map((parameter) => /^\w+\s*[?=]/.test(parameter)),
    );
  }
  return found;
}

/**
 * `asRetriever` is documented by the shape of its options bag, not by the
 * six positional parameters `@langchain/core` gives it. That is a summary the
 * reader is better off with, not drift.
 */
const DOCUMENTED_AS_AN_OPTIONS_BAG = new Set(['asRetriever']);

const sourceSignatures = signatures();

describe('the source signatures parse', () => {
  it('finds the methods, so an empty scan cannot pass', () => {
    expect(sourceSignatures.get('similaritySearchVectorWithScore')).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(sourceSignatures.get('similaritySearch')).toEqual([false, true, true, true, true]);
    expect(sourceSignatures.size).toBeGreaterThan(10);
  });
});

describe.each(DOCS)('%s shows every parameter as the code has it', (doc) => {
  const text = read(doc);

  /** Signature rows: `| `name(a, b?)` | … |`. */
  const rows = [...text.matchAll(/^\| `(\w+)\(([^`]*)\)`/gm)]
    .map((match) => ({ name: match[1] as string, shown: match[2] as string }))
    .filter(({ name, shown }) => {
      // A row showing a destructured bag (`{ k, fetchK }`) is describing the
      // bag's contents, not the positional parameter it arrives in.
      if (shown.includes('{')) return false;
      if (DOCUMENTED_AS_AN_OPTIONS_BAG.has(name)) return false;
      return sourceSignatures.has(name);
    });

  it('documents signatures at all, so an empty scan cannot pass', () => {
    expect(rows.length).toBeGreaterThan(3);
  });

  it('agrees with the source on arity and on which parameters may be omitted', () => {
    const drift = rows
      .map(({ name, shown }) => {
        const documented = splitParameters(shown).map((parameter) => parameter.endsWith('?'));
        const actual = sourceSignatures.get(name) as boolean[];
        const agrees =
          documented.length === actual.length &&
          documented.every((optional, i) => optional === actual[i]);
        return agrees ? undefined : `${name}(${shown}) — source: ${describe_(name, actual)}`;
      })
      .filter((entry) => entry !== undefined);
    expect(drift).toEqual([]);
  });
});

/** Render a source signature the way a doc row would show it. */
function describe_(name: string, optional: boolean[]): string {
  return `${name}(${optional.map((o, i) => `arg${i + 1}${o ? '?' : ''}`).join(', ')})`;
}
