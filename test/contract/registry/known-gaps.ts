import type { KnownGap } from './types.js';

/**
 * Contracts the code does not honour yet, each named by the finding that closes
 * it.
 *
 * The registry states the intended contract from the first commit, so until the
 * remediation lands there are cases that legitimately fail. They are listed here
 * rather than softened in the contract, because a contract written down to what
 * the code happens to do is worth nothing — that is how a suite at 100% coverage
 * came to certify thirty defects.
 *
 * The runner enforces this ledger in both directions:
 *
 * - a failure that is **not** listed fails the suite, so nothing new hides among
 *   the known ones;
 * - an entry that **no longer reproduces** fails the suite, so a fixed gap
 *   cannot be left behind to rot.
 *
 * The list only shrinks. It is empty when the audit is closed.
 */
export const KNOWN_GAPS: readonly KnownGap[] = [
  // ── F-18 · delete forwards its ids to AWS unvalidated ────────────────────
  //
  // `delete.ts:71` checks `Array.isArray(ids)` and nothing about the elements,
  // so a `null`, an empty string, a number or a hole is sent as a vector key.
  // The write path rejects all of these locally through `assertIdsWellFormed`.
  ...(
    [
      ['array with hole', 'a hole reads as `undefined` and is sent as a key'],
      ['array with undefined', 'an explicit `undefined` is sent as a key'],
      ['nested array', 'an array is sent where a string key belongs'],
      ['array of null', '`null` is sent as a key'],
      ['array of empty string', "`''` is sent as a key; a vector key is 1–1024 characters"],
      ['array of number', 'a number is sent as a key'],
    ] as const
  ).map(([label, note]): KnownGap => ({
    finding: 'F-18',
    symbol: 'AmazonS3Vectors.delete',
    property: 'P2',
    caseLabel: `ids = ${label}`,
    note: `${note}. Reuse assertIdsWellFormed, minus the duplicate rule, which delete does not need.`,
  })),

  // ── F-27 · a non-object options bag is ignored rather than refused ────────
  //
  // `addVectors(vectors, documents, 0)` reads `options?.ids` off a number,
  // gets undefined, and writes as though no options were passed. The caller
  // asked for something; they are told nothing.
  {
    finding: 'F-27',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'options = ',
    note: 'A non-nullish options argument that is not a plain object must raise VALIDATION.',
  },
];
