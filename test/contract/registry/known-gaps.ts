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
