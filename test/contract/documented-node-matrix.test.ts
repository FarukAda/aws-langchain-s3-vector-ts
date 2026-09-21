import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The Node versions the prose claims CI runs are the ones it runs.
 *
 * `ci.yml` gained Node 26 and two sentences were left behind saying the matrix
 * was 22 and 24 — one in README's Runtime Requirements, one in CONTRIBUTING's
 * description of what CI does. Three other places in README said 22, 24 and 26
 * correctly, which is what made the two stale ones invisible: every reader who
 * checked found a version of the claim that was true.
 *
 * Nothing could notice. The docs-drift gate regenerates TypeDoc output and the
 * links gate resolves anchors; neither reads a workflow. So this is the rule as
 * a gate: a shipped document may mention the matrix or not, but a line that
 * *enumerates* it has to enumerate all of it. Adding a Node line to the matrix
 * and forgetting a sentence fails here rather than in a reader's terminal.
 */
const ROOT = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** The documents that describe CI to somebody who has not read it. */
const DOCS = ['README.md', 'CONTRIBUTING.md'] as const;

/**
 * The Node versions `ci.yml`'s test matrix declares.
 *
 * Read out of the workflow rather than restated here: a list written twice is
 * the defect this suite exists to catch, and copying it into the test would
 * reproduce it one directory over.
 */
function matrixVersions(): string[] {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
  // `node: ['22', '24', '26']` — the only `node:` key in the file that carries a
  // list. A match that finds nothing fails the guard below rather than passing
  // an empty set around.
  const line = /^\s*node:\s*\[([^\]]*)\]/m.exec(workflow);
  return [...(line?.[1] ?? '').matchAll(/\d+/g)].map((m) => m[0]);
}

/**
 * Two or more versions written as a list: `22/24/26`, `22, 24 and 26`.
 *
 * A single number is not an enumeration of the matrix — "the floor is 22",
 * "Node 20 reached end of life" — so it is left alone. Only prose that sets out
 * to list the matrix is held to listing it.
 */
const ENUMERATION = /\b\d{2}(?:(?:\s*\/\s*|,\s*|\s+and\s+)\d{2})+/g;

/** Whether a line is talking about the versions CI runs, rather than about anything else. */
const mentionsTheMatrix = (line: string): boolean => /\bNode\b|\bCI runs\b/.test(line);

interface Claim {
  readonly doc: string;
  readonly line: number;
  readonly versions: string[];
  readonly text: string;
}

function claimsIn(doc: string): Claim[] {
  return readFileSync(resolve(ROOT, doc), 'utf8')
    .split('\n')
    .flatMap((text, index) =>
      mentionsTheMatrix(text)
        ? [...text.matchAll(ENUMERATION)].map((match) => ({
            doc,
            line: index + 1,
            versions: [...match[0].matchAll(/\d{2}/g)].map((m) => m[0]),
            text: text.trim(),
          }))
        : [],
    );
}

const MATRIX = matrixVersions();
const CLAIMS = DOCS.flatMap(claimsIn);

describe("the prose about CI's Node matrix agrees with ci.yml", () => {
  it('reads the matrix out of the workflow, so a broken scan cannot pass silently', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(2);
  });

  it('finds the claims to check, so a broken scan cannot pass silently', () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(DOCS.length);
  });

  it.each(CLAIMS.map((claim) => [`${claim.doc}:${claim.line}`, claim] as const))(
    '%s names every version the matrix runs',
    (_label, claim) => {
      // The message carries the line, because the point of failing is that
      // somebody has to edit that sentence.
      expect({ line: claim.text, versions: [...claim.versions].sort() }).toEqual({
        line: claim.text,
        versions: [...MATRIX].sort(),
      });
    },
  );
});
