import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * Every link in the shipped documentation resolves.
 *
 * A heading renamed, a file moved, a section deleted — each leaves a link that
 * looks fine in review and 404s for a reader. These files were rewritten
 * wholesale during the contract rework, which is exactly when that happens.
 *
 * External `http(s)` links are not fetched: a network call in a unit suite
 * makes it flaky and slow, and a dead third-party URL is not this repository's
 * defect to fail on.
 */
const ROOT = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const DOCS = ['README.md', 'CHANGELOG.md', 'src/guide.md', 'docs/STABILITY.md'] as const;

/**
 * GitHub's anchor rule, as far as these documents exercise it.
 *
 * Pictographs are dropped but the variation selector that follows one is kept,
 * which is why `## Architecture` under a building emoji anchors with an
 * invisible character in front of it. Getting that wrong makes every emoji
 * heading look broken.
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[^\p{L}\p{N}\s️-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/^#{1,6}\s+(.*)$/gm)) {
    out.add(slug(match[1]!));
  }
  return out;
}

/**
 * `[text](target)` links, ignoring images and fenced code.
 *
 * The text may itself contain a bracketed span — a badge is
 * `[![alt](image)](link)`, and a pattern that stops at the first `]` misses
 * the outer link entirely, which is how a broken badge target hides.
 */
function linksOf(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/g, '');
  return [
    ...withoutCode.matchAll(/(?<!!)\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
  ].map((m) => m[1]!);
}

describe.each(DOCS)('%s links resolve', (doc) => {
  const path = join(ROOT, doc);
  const text = readFileSync(path, 'utf8');
  const headings = headingsOf(text);
  const links = linksOf(text);

  it('points every in-document anchor at a heading that exists', () => {
    const anchors = links.filter((l) => l.startsWith('#')).map((l) => l.slice(1));
    expect(anchors.filter((a) => !headings.has(a))).toEqual([]);
  });

  it('points every relative path at a file that exists', () => {
    const relative = links.filter(
      (l) => !l.startsWith('#') && !/^[a-z]+:/i.test(l) && !l.startsWith('//'),
    );
    const missing = relative.filter((l) => {
      const [target] = l.split('#');
      return !existsSync(resolve(dirname(path), target!));
    });
    expect(missing).toEqual([]);
  });

  it('points every anchor inside a relative link at a heading in that file', () => {
    const withAnchors = links.filter(
      (l) => !l.startsWith('#') && !/^[a-z]+:/i.test(l) && l.includes('#'),
    );
    const broken = withAnchors.filter((l) => {
      const [target, anchor] = l.split('#');
      const targetPath = resolve(dirname(path), target!);
      if (!existsSync(targetPath) || !targetPath.endsWith('.md')) return false;
      return !headingsOf(readFileSync(targetPath, 'utf8')).has(anchor!);
    });
    expect(broken).toEqual([]);
  });
});

describe('the link scan itself', () => {
  it('finds the links it is supposed to check, so a broken scan cannot pass silently', () => {
    // src/guide.md carries none today; the aggregate is what proves the
    // scanner works rather than quietly matching nothing.
    const total = DOCS.map((doc) => linksOf(readFileSync(join(ROOT, doc), 'utf8')).length).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeGreaterThan(20);
  });
});
