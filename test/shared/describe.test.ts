import { describe, it, expect } from '@jest/globals';

import { describeRecord, describeValue } from '../../src/shared/describe.js';

describe('describeRecord', () => {
  it('names the position alone when the record has no id', () => {
    expect(describeRecord('Vector id', { recordIndex: 3 })).toBe('Vector id at index 3');
  });

  it('quotes the id, so an empty or blank one is still visible', () => {
    expect(describeRecord('Document', { recordIndex: 0, recordId: ' ' })).toBe(
      'Document at index 0 (id " ")',
    );
  });

  it('keeps an id of 64 characters whole', () => {
    const id = 'x'.repeat(64);
    expect(describeRecord('Vector', { recordIndex: 1, recordId: id })).toBe(
      `Vector at index 1 (id "${id}")`,
    );
  });

  it('cuts a longer id to 64 characters, which context.recordId carries whole', () => {
    expect(describeRecord('Vector', { recordIndex: 1, recordId: 'x'.repeat(65) })).toBe(
      `Vector at index 1 (id "${'x'.repeat(64)}…")`,
    );
  });
});

describe('describeValue, for the kinds that are not objects', () => {
  it.each([
    ['a string', 'text', 'a string'],
    ['a number', 7, 'a number'],
    ['null', null, 'null'],
    // The one kind that is also a value, so it takes no article: "received an
    // undefined" is what a caller read on the likeliest first-run mistake there
    // is, an unset environment variable where the bucket name belongs.
    ['undefined', undefined, 'undefined'],
  ])('describes %s', (_label, value, want) => {
    expect(describeValue(value)).toBe(want);
  });
});

describe('describeValue with a hostile object', () => {
  /** An object whose `constructor.name` is whatever the caller's data said. */
  const withConstructorName = (name: unknown): unknown => ({ constructor: { name } });

  it('describes an ordinary class instance by its name', () => {
    expect(describeValue(new Map())).toBe('a Map instance');
  });

  it('caps a constructor name, so a message cannot be grown without limit', () => {
    // `constructor.name` is reachable from a filter operand or a document's
    // pageContent, i.e. from a request body. Uncapped, 50 KB of it became a
    // 50,084-byte VALIDATION message from a few hundred bytes of input, and
    // that message lands in the application's logs and its LangSmith traces.
    const described = describeValue(withConstructorName('X'.repeat(50_000)));
    expect(described.length).toBeLessThan(120);
  });

  it('strips control characters, so a name cannot forge a log line', () => {
    const described = describeValue(withConstructorName('x\nFATAL forged-line'));
    expect(described).not.toContain('\n');
    expect([...described].some((char) => char.codePointAt(0)! < 0x20)).toBe(false);
  });

  it('strips DEL as well as C0', () => {
    expect(describeValue(withConstructorName('a\u007fb'))).toBe('an ab instance');
  });

  it('keeps an astral character, which is above the space rather than below it', () => {
    // The strip compares characters as strings; a surrogate pair starts at
    // U+D800, so it must survive rather than be read as something to remove.
    expect(describeValue(withConstructorName('Grüße😀'))).toBe('a Grüße😀 instance');
  });

  it('falls back to the object wording when the name is not a string', () => {
    expect(describeValue(withConstructorName(Object.create(null)))).toBe('an object');
    expect(describeValue(withConstructorName(42))).toBe('an object');
  });

  it('does not throw when reading the name throws', () => {
    // The doc comment promises this function throws nothing — it is used while
    // reporting another error, so a throw here replaces the caller's real
    // failure with a formatting one.
    const hostile = {
      get constructor(): never {
        throw new Error('nope');
      },
    };
    expect(() => describeValue(hostile)).not.toThrow();
  });

  it('does not throw when the name is an object with no prototype', () => {
    expect(() => describeValue(withConstructorName(Object.create(null)))).not.toThrow();
  });

  it('falls back when the name is nothing but control characters', () => {
    // Stripping can empty a name that was not empty. "a  instance" would name
    // nothing and read as a formatting bug.
    expect(describeValue(withConstructorName('\n\t\u0000'))).toBe('an object');
  });
});
