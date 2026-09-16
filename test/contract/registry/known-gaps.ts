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
    finding: 'R2',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'document metadata value = empty array [benign]',
    note: 'Written and left to AWS, which rejects an empty array; should be VALIDATION before any request.',
  },
  {
    finding: 'R2',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'document metadata value = mixed array [benign]',
    note: 'Written and left to AWS, which rejects strings mixed with numbers; should be VALIDATION.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'document metadata value = lone surrogate [benign]',
    note: 'Written; AWS fails the whole request with SerializationException. Should be VALIDATION.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'document metadata value = lone low surrogate [benign]',
    note: 'Written; AWS fails the whole request with SerializationException. Should be VALIDATION.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'an id with an unpaired surrogate is refused [benign]',
    note: 'The id is written; AWS fails the request. Should be VALIDATION with the id rules.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'page content with an unpaired surrogate is refused [benign]',
    note: 'Page content is stored as metadata, so AWS fails the request. Should be VALIDATION.',
  },
  {
    finding: 'N3',
    symbol: 'AmazonS3Vectors.addVectors',
    property: 'P2',
    caseLabel: 'a metadata key with an unpaired surrogate is refused [benign]',
    note: 'Written; AWS fails the request. Should be VALIDATION.',
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
];
