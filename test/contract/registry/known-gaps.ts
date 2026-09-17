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
export const KNOWN_GAPS: readonly KnownGap[] = [];
