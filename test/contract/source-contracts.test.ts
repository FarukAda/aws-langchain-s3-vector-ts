import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The contract standard, enforced on the source itself.
 *
 * The contract standard for this package is that every function states what it
 * accepts, returns, throws and guarantees. That was checked by hand twice and
 * drifted twice: a refactor moved a function and left its contract behind,
 * pointing at the function that happened to follow it. These are the checks
 * that make the standard a gate rather than an intention.
 *
 * They are deliberately syntactic. A test cannot judge whether a contract is
 * *true* — that is what the rest of the suite is for — but it can insist that
 * one exists, sits on the function it describes, and names the two things a
 * caller cannot discover from the type: what comes back, and what is thrown.
 */
const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

interface Declaration {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly doc: string;
  readonly isClass: boolean;
}

/** Every exported function and class, with the doc block directly above it. */
function declarations(): Declaration[] {
  const out: Declaration[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const match =
        /^export (?:async )?function\*? (\w+)/.exec(line) ?? /^export class (\w+)/.exec(line);
      if (!match) return;
      const doc: string[] = [];
      let cursor = index - 1;
      if (lines[cursor]?.trim() === '*/') {
        while (cursor >= 0 && !lines[cursor]!.trim().startsWith('/**')) {
          doc.unshift(lines[cursor]!);
          cursor -= 1;
        }
      }
      out.push({
        file: file.slice(SRC.length),
        line: index + 1,
        name: match[1]!,
        doc: doc.join('\n'),
        isClass: line.startsWith('export class'),
      });
    });
  }
  return out;
}

const declared = declarations();

describe('every exported function carries a contract', () => {
  it('finds the exports to check, so a broken scan cannot pass silently', () => {
    expect(declared.length).toBeGreaterThan(40);
  });

  it.each(declared.filter((d) => !d.isClass).map((d) => [`${d.file}:${d.name}`, d] as const))(
    '%s documents what it returns and what it throws',
    (_label, declaration) => {
      const doc = declaration.doc.toLowerCase();
      expect(doc.length).toBeGreaterThan(0);
      expect(doc).toMatch(/returns/);
      expect(doc).toMatch(/throws/);
    },
  );

  it.each(declared.filter((d) => d.isClass).map((d) => [`${d.file}:${d.name}`, d] as const))(
    '%s carries a class-level description, its members carrying their own contracts',
    (_label, declaration) => {
      expect(declaration.doc.length).toBeGreaterThan(0);
    },
  );
});

describe('no contract is orphaned from the function it describes', () => {
  it.each(sourceFiles(SRC).map((f) => [f.slice(SRC.length), f] as const))(
    '%s has no doc block immediately followed by another',
    (_label, file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const endsDoc = (line: string): boolean => {
        const trimmed = line.trim();
        // Either the last line of a block, or a whole block on one line.
        return trimmed === '*/' || (trimmed.startsWith('/**') && trimmed.endsWith('*/'));
      };
      const orphans = lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line, index }) =>
            endsDoc(line) && (lines[index + 1]?.trim().startsWith('/**') ?? false),
        )
        .map(({ index }) => index + 2);
      // A doc block whose next line opens another doc block describes nothing:
      // the declaration it was written for has moved or been deleted.
      expect(orphans).toEqual([]);
    },
  );
});

describe('every field of an options type is documented', () => {
  it.each(sourceFiles(SRC).map((f) => [f.slice(SRC.length), f] as const))(
    '%s documents each interface field',
    (_label, file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const undocumented: string[] = [];
      let current: string | undefined;
      lines.forEach((line, index) => {
        const open = /^export (?:interface|type) (\w+)/.exec(line);
        if (open) {
          // Only a declaration whose body opens on this line has fields below it.
          // A one-line `type A = B & C;` or `interface A extends B {}` has none,
          // and must not leave its name attached to the lines that follow.
          current = /\{\s*$/.test(line) ? open[1] : undefined;
          return;
        }
        if (current !== undefined && /^\}/.test(line)) {
          current = undefined;
          return;
        }
        const field = /^ {2}(?:readonly )?(\w+)\??\s*:/.exec(line);
        if (current === undefined || !field) return;
        const previous = lines[index - 1]?.trim() ?? '';
        if (!previous.endsWith('*/') && !previous.startsWith('//')) {
          undocumented.push(`${current}.${field[1]!}`);
        }
      });
      expect(undocumented).toEqual([]);
    },
  );
});

describe('the package cites primary sources, not another implementation', () => {
  // The Python package is an example, not an authority. Every behaviour here
  // is justified on its own merits and cited to an AWS reference, the SDK
  // model or `@langchain/core`. A claim of the form "matches langchain-aws" is
  // not a justification, and it drifted into fourteen places before this
  // rework removed them.
  const SHIPPED = ['README.md', 'CHANGELOG.md'] as const;

  // What a contributor is told to justify a change by. This is where the rule
  // has to hold hardest: CONTRIBUTING.md used to instruct contributors to track
  // that package for behaviour and port its fixes, and the feature-request
  // template asked submitters whether it did the same thing.
  const GOVERNANCE = [
    'CONTRIBUTING.md',
    'README.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
  ] as const;

  it.each(sourceFiles(SRC).map((f) => [f.slice(SRC.length), f] as const))(
    'src/%s cites no foreign implementation',
    (_label, file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/langchain[-_]aws/i);
      expect(text).not.toMatch(/\bPython\b/);
    },
  );

  it.each(SHIPPED)('%s justifies nothing by a foreign implementation', (doc) => {
    const text = readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8');
    // The changelog records what past releases did, and two of them departed
    // from that package deliberately. It may keep that history; it may not
    // justify present behaviour by it.
    expect(text).not.toMatch(/matches the Python/i);
    expect(text).not.toMatch(/faithful port/i);
    expect(text).not.toMatch(/parity with Python/i);
  });

  it.each(GOVERNANCE)('%s names no foreign implementation at all', (doc) => {
    const text = readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8');
    expect(text).not.toMatch(/langchain[-_]aws/i);
    expect(text).not.toMatch(/\bPython\b/);
  });
});

describe('the source keeps the constraints the design fixed', () => {
  const banned: [string, RegExp][] = [
    ['a TODO or FIXME', /\b(TODO|FIXME|XXX)\b/],
    ['a suppressed type error', /@ts-(ignore|expect-error|nocheck)/],
    ['a disabled lint rule', /eslint-disable/],
    ['an `any` annotation', /:\s*any[\s;),[]/],
    ['an `as any` cast', /\bas any\b/],
    ['a console call', /\bconsole\.(log|warn|error|info|debug)\(/],
    ['an instanceof test', /\binstanceof\b/],
  ];

  it.each(banned)('contains no %s', (_label, pattern) => {
    const offenders = sourceFiles(SRC)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ file: file.slice(SRC.length), line, index }))
          .filter(({ line }) => {
            const trimmed = line.trim();
            // Prose about a construct is not the construct: these all appear
            // in contracts explaining why they are not used.
            const isComment =
              trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/**');
            return !isComment && pattern.test(line);
          }),
      )
      .map(({ file, index }) => `${file}:${index + 1}`);
    expect(offenders).toEqual([]);
  });
});
