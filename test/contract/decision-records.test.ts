import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from '@jest/globals';

/**
 * The shape of a decision record, enforced on the records themselves.
 *
 * A record is worth writing because a future developer will read it instead of
 * reconstructing the reasoning from code that does not contain it. That only
 * works if every record answers the same questions in the same places, and if
 * the numbering can be trusted — a reused number makes a reference to "record
 * 4" ambiguous forever.
 *
 * Like every contract check here, these are syntactic. A test cannot judge
 * whether a decision was a good one, or whether the consequences listed are the
 * real ones. It can insist that the sections exist, that the numbering is
 * sequential and unique, and that the index lists what is on disk.
 */
const DECISIONS = new URL('../../docs/decisions/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

/** The statuses a record may carry. A reversed record keeps its file. */
const STATUSES = ['Accepted', 'Superseded', 'Deprecated', 'Proposed'];

interface Record {
  readonly file: string;
  readonly number: number;
  readonly text: string;
}

function records(): Record[] {
  return readdirSync(DECISIONS)
    .filter((file) => /^\d{4}-.+\.md$/.test(file))
    .map((file) => ({
      file,
      number: Number(file.slice(0, 4)),
      text: readFileSync(join(DECISIONS, file), 'utf8'),
    }))
    .sort((a, b) => a.number - b.number);
}

describe('every decision record has the shape a reader can rely on', () => {
  it('finds the records to check, so a broken scan cannot pass silently', () => {
    expect(records().length).toBeGreaterThanOrEqual(10);
  });

  it.each(records().map((record) => [record.file, record] as const))(
    '%s carries a title, context, decision, status and consequences',
    (_label, record) => {
      expect(record.text.startsWith(`# ${record.number}. `)).toBe(true);
      for (const section of ['## Status', '## Context', '## Decision', '## Consequences']) {
        expect(record.text).toContain(section);
      }
    },
  );

  it.each(records().map((record) => [record.file, record] as const))(
    '%s names all three kinds of consequence',
    (_label, record) => {
      // Positive, negative and neutral. A record listing only what it bought is
      // an argument; one listing what it cost is a record.
      const consequences = record.text.slice(record.text.indexOf('## Consequences'));
      for (const kind of ['Positive', 'Negative', 'Neutral']) {
        expect(consequences).toContain(kind);
      }
    },
  );

  it.each(records().map((record) => [record.file, record] as const))(
    '%s carries a status the index can render',
    (_label, record) => {
      const status = /## Status\s*\n\s*\n([A-Za-z]+)/.exec(record.text)?.[1];
      expect(STATUSES).toContain(status);
    },
  );

  it('numbers the records sequentially from one, with none reused', () => {
    expect(records().map((record) => record.number)).toEqual(
      records().map((_record, index) => index + 1),
    );
  });

  it('lists every record in the index, and nothing that is not there', () => {
    const index = readFileSync(join(DECISIONS, 'README.md'), 'utf8');
    const listed = [...index.matchAll(/\((\d{4}-[^)]+\.md)\)/g)].map((match) => match[1]!);
    expect(listed.sort()).toEqual(
      records()
        .map((record) => record.file)
        .sort(),
    );
  });
});
