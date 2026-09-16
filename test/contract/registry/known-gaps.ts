import type { KnownGap } from './types.js';

/**
 * Contracts the code does not honour yet, each named by the finding that closes
 * it.
 *
 * **Currently empty.** Every executable contract in the registry is honoured:
 * `delete` and `addVectors` pass all six properties over the whole corpus, on
 * both axes, with nothing excused.
 *
 * It was not empty when it was written, and that was the point. The registry
 * states the intended contract from the first commit, so before the remediation
 * landed there were cases that legitimately failed — 40 on `delete` alone, and
 * 124 once `addVectors` was registered. Listing them here rather than softening
 * the contract is what kept the suite green without letting the gaps out of
 * sight, because a contract written down to what the code happens to do is worth
 * nothing. That is how a suite at 100% coverage came to certify thirty defects.
 *
 * The runner enforces this ledger in both directions:
 *
 * - a failure that is **not** listed fails the suite, so nothing new hides among
 *   the known ones;
 * - an entry that **no longer reproduces** fails the suite, so a fixed gap
 *   cannot be left behind to rot.
 *
 * The second half is what emptied it. Each entry was removed only after the
 * suite insisted it had stopped failing, rather than when someone believed it
 * had — which is also how the last seven went, in one step, when validation
 * parity landed.
 *
 * Adding an entry is allowed: a contract found to be wrong is worth stating
 * before it is met. But every entry needs the finding that closes it, and from
 * there the list only shrinks.
 */
export const KNOWN_GAPS: readonly KnownGap[] = [];
