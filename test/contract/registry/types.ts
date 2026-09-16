import type { AmazonS3Vectors } from '../../../src/s3-vectors.js';
import type { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import type { Ambient } from './harness.js';

/** Behavioural promises a contract can make that are not about types. */
export type Guarantee =
  /** The call does not read the caller's arrays again after validating them. */
  | 'does-not-mutate-inputs'
  /** No internal field is an enumerable own property of the store. */
  | 'no-enumerable-internals'
  /** A thrown error's `code` and `context` cannot be reassigned. */
  | 'immutable-error'
  /** Arrays handed back are the call's own, never the caller's instance. */
  | 'fresh-arrays';

/** One input, under one ambient condition. */
export interface ContractCase<I> {
  /** Names the case in a failure. Must identify it without further context. */
  readonly label: string;
  /** The argument under test. */
  readonly input: I;
  /** The world it runs in. */
  readonly ambient: Ambient;
}

/**
 * The executable contract for one public entry point.
 *
 * This is the source of truth the conformance suite checks the code against —
 * written from what the contract *should* say, never transcribed from what the
 * code currently does. A registry copied out of the implementation would pass
 * on day one and prove nothing, which is precisely how a suite at 100% coverage
 * came to miss thirty findings.
 */
export interface EntryPointContract<I> {
  /** Fully qualified, e.g. `AmazonS3Vectors.delete`. */
  readonly symbol: string;
  /** Where its prose contract lives, for the JSDoc cross-check. */
  readonly docSource: string;
  /**
   * The closed set of codes that may escape. Anything else — a raw `TypeError`
   * included — is a contract breach, not an edge case.
   */
  readonly mayThrow: ReadonlySet<S3VectorsErrorCode>;
  /**
   * Context keys every error of a given code must carry. Absent codes are
   * unconstrained beyond `operation`, which every error carries.
   */
  readonly requiredContext: Partial<Record<S3VectorsErrorCode, readonly string[]>>;
  /**
   * The codes an input outside {@link accepts} may be refused with. Defaults to
   * `VALIDATION` alone.
   *
   * Most out-of-domain input is a plain caller mistake and gets `VALIDATION`.
   * A few are refused more specifically on purpose and the narrower code is the
   * better answer: vectors of differing dimension in one batch are
   * `INDEX_CONFIG_MISMATCH`, because the caller's real problem is which index
   * they are writing to, not the shape of their argument. Declaring that here
   * keeps it a decision rather than an exception.
   */
  readonly outOfDomainCodes?: ReadonlySet<S3VectorsErrorCode>;
  /**
   * Whether this input is inside the documented accepted domain.
   *
   * A declarative test — types, ranges, literal cases. It must not call the
   * library's own validator, which would make every check vacuous, and must not
   * restate `validation.ts` line by line, which would drift from it.
   */
  readonly accepts: (input: I) => boolean;
  /** Performs the call. */
  readonly invoke: (store: AmazonS3Vectors, input: I) => Promise<unknown>;
  /** Every case this entry point is checked against. */
  readonly cases: () => readonly ContractCase<I>[];
  /** Requests this call may have in flight at once, when it issues any. */
  readonly maxConcurrency?: number;
  /** Behavioural promises, checked by the properties that implement them. */
  readonly guarantees: readonly Guarantee[];
}

/**
 * A contract the code does not yet honour, named by the finding that will fix
 * it.
 *
 * The registry states the intended contract from the start, so before the
 * remediation lands there are cases that legitimately fail. Recording them here
 * keeps the suite green *and* keeps them visible: the runner asserts that every
 * gap listed still reproduces, so an entry cannot outlive its finding, and that
 * no failure occurs which is not listed, so nothing new hides among them.
 *
 * The ledger only ever shrinks. It is empty when the audit is closed.
 */
export interface KnownGap {
  /** The finding that will close it, e.g. `F-18`. */
  readonly finding: string;
  /** The `symbol` of the entry point it belongs to. */
  readonly symbol: string;
  /** The property that fails: `P1`…`P6`. */
  readonly property: string;
  /** Matched against the start of the failing case's label. */
  readonly caseLabel: string;
  /** What the code does today, and what it should do instead. */
  readonly note: string;
}
