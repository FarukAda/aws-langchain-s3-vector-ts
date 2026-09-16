import type { KnownGap } from './types.js';

/**
 * Contracts the code does not honour yet, each named by the finding that closes
 * it.
 *
 * The registry states the intended contract before the code meets it, so between
 * a contract being written and its remediation landing there are cases that
 * legitimately fail. Listing them here rather than softening the contract is
 * what keeps the suite green without letting the gaps out of sight: a contract
 * written down to what the code happens to do is worth nothing. That is how a
 * suite at 100% coverage once certified thirty defects.
 *
 * The runner enforces this ledger in both directions:
 *
 * - a failure that is **not** listed fails the suite, so nothing new hides among
 *   the known ones;
 * - an entry that **no longer reproduces** fails the suite, so a fixed gap
 *   cannot be left behind to rot.
 *
 * An entry matches the start of a case label, so each one carries its ambient
 * suffix: without `[benign]`, `… = null` would also claim
 * `… = null-prototype object`.
 *
 * Adding an entry is allowed — a contract found to be wrong is worth stating
 * before it is met — but every entry needs the finding that closes it, and from
 * there the list only shrinks. It is empty whenever no remediation is under way.
 */
export const KNOWN_GAPS: readonly KnownGap[] = [
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'an id with an unpaired surrogate is refused [benign]',
    note: 'The id is written; AWS fails the request. Should be VALIDATION with the id rules.',
  },
  {
    finding: 'R8',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P1',
    caseLabel: 'a null vector after the first is refused [benign]',
    note: 'Reads .length of null and escapes as UNEXPECTED_ERROR; should be VALIDATION.',
  },
  {
    finding: 'R8',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'a null vector after the first is refused [benign]',
    note: 'Refused with UNEXPECTED_ERROR rather than VALIDATION.',
  },
  {
    finding: 'R1',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel:
      'vectors of differing dimension across batches are refused before any write [benign]',
    note: 'Batch 0 is written before batch 1 is checked; the whole input should be checked first.',
  },
  {
    finding: 'R1',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'metadata S3 Vectors rejects in a later batch is refused before any write [benign]',
    note: 'Batch 0 is written before batch 1 is checked; the whole input should be checked first.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.delete',
    property: 'P2',
    caseLabel: 'an id with an unpaired surrogate is refused [benign]',
    note: 'Sent; AWS fails the request with SerializationException. Should be VALIDATION.',
  },
  ...(
    [
      ['undefined', 'R1'],
      ['null', 'R1'],
      ['NaN', 'R1'],
      ['Infinity', 'R1'],
      ['-Infinity', 'R1'],
      ['lone surrogate', 'R1+N3'],
      ['empty array', 'R1+R2'],
      ['empty object', 'R1'],
      ['array with hole', 'R1'],
      ['array with undefined', 'R1'],
      ['nested array', 'R1'],
      ['array of null', 'R1'],
      ['__proto__ key', 'R1'],
      ['null-prototype object', 'R1'],
      ['function', 'R1'],
      ['symbol', 'R1'],
      ['bigint', 'R1'],
      ['date', 'R1'],
      ['extra keys', 'R1'],
      ['mixed array', 'R1+R2'],
      ['array of boolean', 'R1'],
      ['lone low surrogate', 'R1+N3'],
      ['multi-key object', 'R1'],
    ] as const
  ).map(([value, finding]): KnownGap => ({
    finding,
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel: `document metadata value = ${value} [benign]`,
    note: 'Checked only after the batch is embedded (and, for a value AWS rejects that no local rule covers yet, not at all).',
  })),
  {
    finding: 'R1',
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel: 'the reserved page-content key in document metadata is refused [benign]',
    note: 'Refused only after the batch is embedded.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel: 'an id with an unpaired surrogate is refused [benign]',
    note: 'Embedded and written; AWS fails the request. Should be VALIDATION with the id rules.',
  },
  {
    finding: 'R1+N3',
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel: 'page content with an unpaired surrogate is refused [benign]',
    note: 'Embedded and written; AWS fails the request. Should be VALIDATION before the embed.',
  },
  {
    finding: 'R1+N3',
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel: 'a metadata key with an unpaired surrogate is refused [benign]',
    note: 'Embedded and written; AWS fails the request. Should be VALIDATION before the embed.',
  },
  {
    finding: 'R1',
    symbol: 'AmazonS3Vectors.addDocuments',
    property: 'P2',
    caseLabel:
      'metadata S3 Vectors rejects in a later batch is refused before anything is spent [benign]',
    note: 'Batch 0 is embedded and written, and batch 1 embedded, before batch 1 is checked.',
  },
  ...(
    [
      'array with hole',
      'array with undefined',
      'nested array',
      'array of null',
      'array of empty string',
      'array of number',
      'mixed array',
      'array of boolean',
    ] as const
  ).map((value): KnownGap => ({
    finding: 'R6',
    symbol: 'AmazonS3Vectors.getByIds',
    property: 'P2',
    caseLabel: `ids = ${value} [benign]`,
    note: 'Sent to GetVectors unvalidated; AWS rejects the whole batch. Should be VALIDATION.',
  })),
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.getByIds',
    property: 'P2',
    caseLabel: 'an id with an unpaired surrogate is refused [benign]',
    note: 'Sent; AWS fails the request with SerializationException. Should be VALIDATION.',
  },
  ...(
    [
      'undefined',
      'null',
      'NaN',
      'Infinity',
      '-Infinity',
      'zero',
      'negative',
      'fractional',
      'huge',
      'true',
      'empty array',
      'empty object',
      'array with hole',
      'array with undefined',
      'nested array',
      'array of null',
      'array of empty string',
      'array of number',
      'array with duplicate',
      '__proto__ key',
      'null-prototype object',
      'function',
      'symbol',
      'bigint',
      'date',
      'extra keys',
      'mixed array',
      'array of boolean',
      'multi-key object',
    ] as const
  ).map((value): KnownGap => ({
    finding: 'N5',
    symbol: 'AmazonS3Vectors.maxMarginalRelevanceSearch',
    property: 'P2',
    caseLabel: `query = ${value} [benign]`,
    note: 'A non-string query is handed to the embeddings model. Should be VALIDATION before the embed.',
  })),
  ...(
    [
      ['options.filter = extra keys', 'N1'],
      ['options.filter = multi-key object', 'N1'],
      ['filter: $in holding null', 'R5'],
      ['filter: $exists holding a string', 'R5'],
      ['filter: $eq holding an array', 'R5'],
      ['filter: $gt holding a string', 'R5'],
      ['filter: $gt holding NaN', 'R5'],
      ['filter: $eq holding NaN', 'D6'],
      ['filter: a Date as the value', 'D6'],
      ['filter: two fields in one object', 'N1'],
      ['filter: two fields inside an $and element', 'N1'],
      ['filter: an empty operator object', 'N2'],
      ['filter: a non-operator key in an operator object', 'N2'],
      ['filter: $and inside a field', 'N2'],
      ['filter: a string with an unpaired surrogate', 'N3'],
    ] as const
  ).map(([label, finding]): KnownGap => ({
    finding,
    symbol: 'AmazonS3Vectors.maxMarginalRelevanceSearch',
    property: 'P2',
    caseLabel: `${label} [benign]`,
    note: 'The filter reaches AWS, which rejects it with a bare "Invalid filter" (or matches nothing). Should be VALIDATION naming the rule.',
  })),
];
