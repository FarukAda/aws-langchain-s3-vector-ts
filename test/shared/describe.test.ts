import { describe, it, expect } from '@jest/globals';

import { describeRecord } from '../../src/shared/describe.js';

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
