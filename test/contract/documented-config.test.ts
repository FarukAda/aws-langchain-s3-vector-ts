import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

import { STORE_CONFIG_KEYS } from '../../src/shared/validation.js';

/**
 * The README's two machine-checkable tables are complete.
 *
 * Both of the gaps this covers were real, and both were the same shape: a
 * change to the code that a human was supposed to remember to mirror in prose.
 *
 * The IAM policy is the one that costs a reader an outage. It is presented as
 * the complete, least-privilege set — "no `s3vectors:*` wildcard" — so a reader
 * pastes it verbatim and deploys. It omitted `s3vectors:TagResource`, which AWS
 * requires *in addition to* `s3vectors:CreateIndex` to create a tagged index
 * (`CreateIndexInput.tags`, SDK model). A store configured with `tags` and
 * exactly this policy fails its first write with `AccessDeniedException`, and
 * the action it is missing never appears in a log, because tags travel inside
 * the `CreateIndex` request rather than a `TagResource` call of their own.
 *
 * The configuration table is the one that costs a reader a feature. It had no
 * rows for `connectionTimeout`, `socketTimeout` or `requestTimeout` — three
 * options that exist, are validated, and were reachable only by reading the
 * type definitions.
 *
 * So: every action the code can issue must be granted by the documented policy
 * and nothing more, and every option the config type accepts must have a row.
 */
const readDoc = (doc: string): string =>
  readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8');

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Every `s3vectors:` action this library can actually send, from its commands. */
function actionsIssued(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/new (\w+)Command\(/g)) {
      found.add(`s3vectors:${match[1] as string}`);
    }
  }
  return [...found].sort();
}

/**
 * Actions the policy must grant that no command names.
 *
 * `TagResource` is a permission without a call: AWS checks it when
 * `CreateIndex` carries tags. Scanning for commands alone can never find it,
 * which is exactly why it went missing.
 */
const IMPLICIT_ACTIONS = ['s3vectors:TagResource'];

/** The `Action` entries of the README's IAM policy, parsed as JSON. */
function actionsGranted(): string[] {
  const readme = readDoc('README.md');
  const section = readme.slice(readme.indexOf('## 🔐 IAM Permissions'));
  const block = /```json\r?\n([\s\S]*?)```/.exec(section);
  expect(block).not.toBeNull();

  const policy = JSON.parse((block as RegExpExecArray)[1] as string) as {
    Statement: { Action: string[] }[];
  };
  return [...new Set(policy.Statement.flatMap((statement) => statement.Action))].sort();
}

describe('the documented IAM policy grants exactly what the code needs', () => {
  const granted = actionsGranted();

  it('parses a policy with statements, so an empty parse cannot pass', () => {
    expect(granted.length).toBeGreaterThan(5);
    expect(granted).toContain('s3vectors:PutVectors');
  });

  it('grants every action a command in src can issue, plus the implicit ones', () => {
    expect(granted).toEqual([...new Set([...actionsIssued(), ...IMPLICIT_ACTIONS])].sort());
  });

  it('grants TagResource, which only a tagged CreateIndex reveals a need for', () => {
    // Called out on its own: the assertion above would keep passing if someone
    // removed both this grant and the entry in IMPLICIT_ACTIONS.
    expect(granted).toContain('s3vectors:TagResource');
  });
});

describe('the documented configuration table lists every option', () => {
  /** Field names of `AmazonS3VectorsConfig`, read from the type itself. */
  const fields = (): string[] => {
    const types = readDoc('src/types.ts');
    const body = types.split('export interface AmazonS3VectorsConfig {')[1]?.split(/\r?\n}/)[0];
    expect(body).toBeDefined();
    return [...(body as string).matchAll(/^ {2}readonly (\w+)\??:/gm)].map((m) => m[1] as string);
  };

  /** Option names the README documents as table rows. */
  const documented = new Set(
    [...readDoc('README.md').matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1] as string),
  );

  it('reads the config type, so an empty scan cannot pass', () => {
    expect(fields()).toContain('vectorBucketName');
    expect(fields().length).toBeGreaterThan(15);
  });

  it('has a row for every field', () => {
    expect(fields().filter((field) => !documented.has(field))).toEqual([]);
  });

  it('is read by name in full, so no option is lost on its way through a factory', () => {
    // `STORE_CONFIG_KEYS` is what `fromTexts` and `fromDocuments` read a
    // configuration by, and what the misspelt-option check knows. An option added
    // to the type and not to the list would be dropped from a configuration held
    // behind accessors, in silence, and an index created without it.
    expect(
      fields().filter((field) => !(STORE_CONFIG_KEYS as readonly string[]).includes(field)),
    ).toEqual([]);
  });
});
