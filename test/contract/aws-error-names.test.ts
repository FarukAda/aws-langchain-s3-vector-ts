import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as sdk from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

/**
 * Every AWS exception name this package acts on is one the service declares.
 *
 * S3 Vectors declares exactly thirteen exception classes and the SDK exports all
 * of them, so this is checkable rather than a matter of care. It was not
 * checked, and three invented names had settled in: `ThrottlingException`,
 * `InternalServerError` and `RequestTimeout` — none of which S3 Vectors emits —
 * were listed as retryable, and the first was named in the `retryable` field
 * documentation as something a caller would see. A caller writing a `switch` on
 * `awsErrorName` against that prose would have written dead branches.
 *
 * `ResourceNotFoundException` was the same mistake in the other direction: the
 * not-found predicate accepted it, so a name the service cannot send was read as
 * proof an index was absent, while `classify.ts` — whose table is exactly those
 * thirteen — called the same value an ordinary request failure. Two modules
 * disagreeing about one value, with nothing able to trigger it, which is
 * precisely why no test caught it.
 *
 * Scope: **code with comments stripped**. That covers a quoted name, an object
 * key in `classify.ts`'s table, and an identifier alike. Prose is deliberately
 * excluded, because a comment has to be able to say that a name is *not* one
 * this service sends — that sentence is what stops the mistake returning.
 * Documentation that is wrong about a name is a different problem, and belongs
 * to the documentation checks.
 */
const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Names that are real failures but not service exceptions. */
const NON_SERVICE_ERRORS = new Set([
  // `@smithy/node-http-handler` raises this on a connection, socket-idle or
  // request timeout. Not in the service model, and not optional to handle: this
  // package applies a socket timeout by default, so callers will see it.
  'TimeoutError',
  // The SDK's abort name, recognised by `aws-abort.ts`.
  'AbortError',
  // Not AWS at all — the platform's own error type, which is what
  // `AbortController.abort()` uses as its default reason.
  'DOMException',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/**
 * `source` with its comments removed.
 *
 * The `[^:]` guard on the line-comment pattern keeps `https://` in a URL from
 * being read as the start of one.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Exception names the code itself names — quoted, as a key, or as an identifier. */
function namedInCode(source: string): Set<string> {
  const matches = [...codeOnly(source).matchAll(/\b([A-Z][A-Za-z]*Exception)\b/g)];
  return new Set(matches.map((m) => m[1] as string));
}

const declared = new Set(
  Object.keys(sdk).filter(
    (name) => name.endsWith('Exception') && name !== 'S3VectorsServiceException',
  ),
);

const isUnknown = (name: string): boolean =>
  !declared.has(name) && name !== 'S3VectorsServiceException' && !NON_SERVICE_ERRORS.has(name);

describe('the AWS exception names this package uses are the service model’s', () => {
  it('reads a real set of names from the SDK, so an empty scan cannot pass', () => {
    expect(declared.size).toBe(13);
    expect(declared.has('ValidationException')).toBe(true);
    expect(declared.has('ThrottlingException')).toBe(false);
  });

  it.each(sourceFiles(SRC).map((file) => [file.slice(SRC.length), file] as const))(
    'src/%s acts on no exception the service does not declare',
    (_label, file) => {
      const unknown = [...namedInCode(readFileSync(file, 'utf8'))].filter(isUnknown);
      expect(unknown).toEqual([]);
    },
  );

  it('sees the whole classification table, so a broken scan cannot pass', () => {
    // `classify.ts` maps every declared exception and writes them as bare object
    // keys, so it proves both that the scan reaches code and that it is not
    // limited to quoted strings.
    const named = namedInCode(readFileSync(join(SRC, 'shared/errors/classify.ts'), 'utf8'));
    expect(named).toEqual(declared);
  });

  it('marks retryable only names that can actually arrive', () => {
    const code = codeOnly(readFileSync(join(SRC, 'shared/errors/wrap-error.ts'), 'utf8'));
    const block = /RETRYABLE_AWS_ERROR_NAMES = new Set\(\[([\s\S]*?)\]\)/.exec(code)?.[1] ?? '';
    const names = [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1] as string);

    expect(names.length).toBeGreaterThan(2);
    expect(names.filter((name) => !declared.has(name) && !NON_SERVICE_ERRORS.has(name))).toEqual(
      [],
    );
  });
});
