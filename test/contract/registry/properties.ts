import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../../src/shared/errors/s3-vectors-error.js';
import { fingerprint } from './fingerprint.js';
import type { Outcome } from './harness.js';
import type { ContractCase, EntryPointContract } from './types.js';

/** One property breach, in the shape the runner reports and the ledger matches. */
export interface Failure {
  readonly property: string;
  readonly symbol: string;
  readonly caseLabel: string;
  readonly detail: string;
}

/** How a thrown value should be described when it is not one of ours. */
function describeThrown(error: unknown): string {
  if (isS3VectorsError(error)) return `S3VectorsError<${error.code}>`;
  if (typeof error === 'object' && error !== null) {
    const named = error as { name?: unknown; message?: unknown };
    const name = typeof named.name === 'string' ? named.name : 'object';
    const message = typeof named.message === 'string' ? named.message : '';
    return `RAW ${name}: ${message.slice(0, 80)}`;
  }
  return `RAW ${typeof error}: ${String(error).slice(0, 80)}`;
}

function fail(property: string, symbol: string, caseLabel: string, detail: string): Failure {
  return { property, symbol, caseLabel, detail };
}

/**
 * P1 — nothing escapes that the contract did not declare.
 *
 * Every rejection must be one of this package's errors, recognised by brand
 * rather than `instanceof`, carrying a code the contract lists. A raw
 * `TypeError` from a response shape, or an untouched provider error, fails
 * here.
 *
 * **Why no entry point declares `UNEXPECTED_ERROR`.** The store's public
 * methods normalise whatever is thrown inside them, so a gap in validation no
 * longer arrives here raw: `null.id` comes back as `UNEXPECTED_ERROR`, coded
 * and well-formed. Declared in a contract, that code would make every such gap
 * a permitted outcome, and this property — the one that found them — would stop
 * finding them. Left undeclared, a gap still fails here, as "threw
 * UNEXPECTED_ERROR, which the contract does not declare"; disabling
 * `assertDocumentObjects` and running this suite shows exactly that. So a
 * failure of that shape is a missing check in `src/`, never a missing entry in
 * `mayThrow`.
 *
 * The one honest source of that code on these entry points — a getter that
 * throws on the caller's own input — is outside what a corpus of values can
 * build, since the harness reads its inputs too. It is pinned in
 * `test/hostile-getters.test.ts` instead.
 */
export function checkClosedEscape<I>(
  contract: EntryPointContract<I>,
  testCase: ContractCase<I>,
  outcome: Outcome,
): Failure[] {
  if (outcome.settled === 'resolved') return [];
  if (!isS3VectorsError(outcome.error)) {
    return [
      fail(
        'P1',
        contract.symbol,
        testCase.label,
        `escaped un-coded: ${describeThrown(outcome.error)}`,
      ),
    ];
  }
  if (!contract.mayThrow.has(outcome.error.code)) {
    return [
      fail(
        'P1',
        contract.symbol,
        testCase.label,
        `threw ${outcome.error.code}, which the contract does not declare`,
      ),
    ];
  }
  return [];
}

/**
 * P2 — an input outside the accepted domain is refused, and refused for free.
 *
 * The property the first draft of this design lacked. The silent-corruption
 * findings never throw: they accept a value the contract excludes and write it.
 * Checking only what escapes cannot see them, so this checks what *doesn't*.
 *
 * "For free" is the second half: refusal must happen before any AWS command and
 * before any embedding call, so an impossible request never costs a round trip
 * or a billable embed.
 */
export function checkRejectsOutsideDomain<I>(
  contract: EntryPointContract<I>,
  testCase: ContractCase<I>,
  outcome: Outcome,
): Failure[] {
  if (contract.accepts(testCase.input)) return [];

  if (outcome.settled === 'resolved') {
    return [
      fail(
        'P2',
        contract.symbol,
        testCase.label,
        'accepted an input outside the documented domain instead of raising VALIDATION',
      ),
    ];
  }
  const failures: Failure[] = [];
  if (!isS3VectorsError(outcome.error)) {
    // P1 already reports the un-coded escape; P2 adds only the domain verdict.
    return [
      fail(
        'P2',
        contract.symbol,
        testCase.label,
        `refused with ${describeThrown(outcome.error)} rather than a coded VALIDATION`,
      ),
    ];
  }
  const allowed = contract.outOfDomainCodes ?? new Set([S3VectorsErrorCode.VALIDATION]);
  if (!allowed.has(outcome.error.code)) {
    failures.push(
      fail(
        'P2',
        contract.symbol,
        testCase.label,
        `refused with ${outcome.error.code}, but this contract refuses out-of-domain input ` +
          `with ${[...allowed].join(' or ')}`,
      ),
    );
  }
  if (outcome.effects.commands.length > 0) {
    failures.push(
      fail(
        'P2',
        contract.symbol,
        testCase.label,
        `spent AWS calls before refusing: ${outcome.effects.commands.join(', ')}`,
      ),
    );
  }
  if (outcome.effects.embedCalls > 0) {
    failures.push(
      fail(
        'P2',
        contract.symbol,
        testCase.label,
        `spent ${outcome.effects.embedCalls} billable embed call(s) before refusing`,
      ),
    );
  }
  return failures;
}

/**
 * P4 — a failure carries the context its code promises.
 *
 * `operation` is required of every error; the rest is per code. This is what
 * makes a partial write recoverable rather than merely reported, and it is the
 * property the one surviving mutant in the audit exposed: an error whose
 * context collapsed to `{}` was caught by none of its seventeen covering tests.
 */
export function checkContextShape<I>(
  contract: EntryPointContract<I>,
  testCase: ContractCase<I>,
  outcome: Outcome,
): Failure[] {
  if (outcome.settled === 'resolved' || !isS3VectorsError(outcome.error)) return [];
  const { code, context } = outcome.error;
  const required = ['operation', ...(contract.requiredContext[code] ?? [])];
  // Spread rather than cast: `S3VectorsErrorContext` has no index signature, and
  // a cast past that would also hide a key being renamed out from under us.
  const bag: Record<string, unknown> = { ...context };
  const missing = required.filter((key) => bag[key] === undefined);
  if (missing.length === 0) return [];
  return [
    fail(
      'P4',
      contract.symbol,
      testCase.label,
      `${code} is missing required context: ${missing.join(', ')}`,
    ),
  ];
}

/**
 * P5 — the call stays inside its declared concurrency ceiling.
 *
 * A cap a caller sets to bound their own request rate is not advisory. MMR
 * ignoring `maxConcurrentBatchCalls` and fanning out ten ways is this property
 * failing.
 */
export function checkEffects<I>(
  contract: EntryPointContract<I>,
  testCase: ContractCase<I>,
  outcome: Outcome,
): Failure[] {
  const cap = contract.maxConcurrency;
  if (cap === undefined || outcome.effects.peakConcurrency <= cap) return [];
  return [
    fail(
      'P5',
      contract.symbol,
      testCase.label,
      `peak concurrency ${outcome.effects.peakConcurrency} exceeds the declared cap of ${cap}`,
    ),
  ];
}

/**
 * P3 — every code the contract declares is actually reachable.
 *
 * Aggregated across an entry point's whole case list rather than per case. A
 * contract promising `NOT_FOUND` for a missing vector id, where nothing can
 * produce it, is documentation of a behaviour that does not exist — which is
 * most of what the audit's doc-drift findings are.
 */
export function checkReachability<I>(
  contract: EntryPointContract<I>,
  observed: ReadonlySet<S3VectorsErrorCode>,
): Failure[] {
  return [...contract.mayThrow]
    .filter((code) => !observed.has(code))
    .map((code) =>
      fail(
        'P3',
        contract.symbol,
        `declares ${code}`,
        `no corpus case produces ${code}; either it cannot happen or the corpus is missing a condition`,
      ),
    );
}

/** Every array reachable from an input, down to the depth an entry point reads one. */
function arraysIn(value: unknown, depth = 0): unknown[] {
  if (depth > 3 || typeof value !== 'object' || value === null) return [];
  const children: unknown[] = Array.isArray(value) ? [...value] : Object.values(value);
  return [
    ...(Array.isArray(value) ? [value] : []),
    ...children.flatMap((child) => arraysIn(child, depth + 1)),
  ];
}

/**
 * P6 — the behavioural promises a contract declares actually hold.
 *
 * `does-not-mutate-inputs`: the input's fingerprint after the call equals the
 * one taken before it. `fresh-arrays`: an array the call resolved with is not
 * one reachable from its input — the record of what was written must not be the
 * caller's own list, or a later mutation of that list rewrites it.
 */
export function checkGuarantees<I>(
  contract: EntryPointContract<I>,
  testCase: ContractCase<I>,
  outcome: Outcome,
  before: string,
): Failure[] {
  const failures: Failure[] = [];
  if (
    contract.guarantees.includes('does-not-mutate-inputs') &&
    fingerprint(testCase.input) !== before
  ) {
    failures.push(fail('P6', contract.symbol, testCase.label, 'changed its input'));
  }
  if (
    contract.guarantees.includes('fresh-arrays') &&
    Array.isArray(outcome.value) &&
    arraysIn(testCase.input).includes(outcome.value)
  ) {
    failures.push(
      fail('P6', contract.symbol, testCase.label, 'returned an array the caller passed in'),
    );
  }
  return failures;
}
