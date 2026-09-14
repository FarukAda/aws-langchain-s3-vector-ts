import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The contract standard, enforced on the source itself.
 *
 * `docs/CONTRACTS.md` says every function states what it accepts, returns,
 * throws and guarantees. That was checked by hand twice and drifted twice: a
 * refactor moved a function and left its contract behind, pointing at the
 * function that happened to follow it. These are the checks that make the
 * standard a gate rather than an intention.
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
          current = open[1];
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
