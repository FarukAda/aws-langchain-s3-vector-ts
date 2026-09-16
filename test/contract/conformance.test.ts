import { beforeAll, describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import type { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';
import { isS3VectorsError } from '../../src/shared/errors/s3-vectors-error.js';
import { HOSTILE_VALUES } from './registry/corpus.js';
import { fingerprint } from './registry/fingerprint.js';
import { runAgainst, type Outcome } from './registry/harness.js';
import { PENDING_ENTRY_POINTS, PUBLIC_ENTRY_POINTS, REGISTRY } from './registry/index.js';
import { KNOWN_GAPS } from './registry/known-gaps.js';
import {
  checkClosedEscape,
  checkContextShape,
  checkEffects,
  checkGuarantees,
  checkReachability,
  checkRejectsOutsideDomain,
  type Failure,
} from './registry/properties.js';
import type { ContractCase, EntryPointContract } from './registry/types.js';

/**
 * The executable contract suite.
 *
 * The contract tests that came before this one are syntactic: they check that a
 * doc block exists, that it says "returns" and "throws", that it sits on the
 * function it describes. `source-contracts.test.ts` says as much in its own
 * header — "a test cannot judge whether a contract is *true*". This is the test
 * that judges it.
 *
 * Each entry point is driven over a shared corpus on two axes — hostile inputs,
 * and ambient conditions that are not inputs at all (a provider that throws, a
 * client that rejects with a string, a malformed response) — and six properties
 * are checked over the result. Failures are collected and asserted once rather
 * than emitted as thousands of Jest cases, which is what keeps the whole matrix
 * inside a suite that runs in seconds.
 */

interface Run {
  readonly testCase: ContractCase<unknown>;
  readonly outcome: Outcome;
  /** The input's fingerprint before the call, which P6 compares against. */
  readonly before: string;
}

async function runContract(contract: EntryPointContract<unknown>): Promise<Run[]> {
  const runs: Run[] = [];
  for (const testCase of contract.cases()) {
    const before = fingerprint(testCase.input);
    const outcome = await runAgainst(testCase.ambient, {}, async (store) =>
      contract.invoke(store, testCase.input),
    );
    runs.push({ testCase, outcome, before });
  }
  return runs;
}

/** Every property breach across one entry point's whole case list. */
function failuresFor(contract: EntryPointContract<unknown>, runs: Run[]): Failure[] {
  const failures: Failure[] = [];
  const observed = new Set<S3VectorsErrorCode>();

  for (const { testCase, outcome, before } of runs) {
    // The ambient condition is part of a case's identity: the same input under
    // a throttled client and a benign one are different cases.
    const labelled: ContractCase<unknown> = {
      ...testCase,
      label: `${testCase.label} [${testCase.ambient.label}]`,
    };
    failures.push(
      ...checkClosedEscape(contract, labelled, outcome),
      ...checkRejectsOutsideDomain(contract, labelled, outcome),
      ...checkContextShape(contract, labelled, outcome),
      ...checkEffects(contract, labelled, outcome),
      ...checkGuarantees(contract, labelled, outcome, before),
    );
    if (outcome.settled === 'rejected' && isS3VectorsError(outcome.error)) {
      observed.add(outcome.error.code);
    }
  }

  failures.push(...checkReachability(contract, observed));
  return failures;
}

/** Whether a failure is one the ledger already accounts for. */
function gapFor(failure: Failure): (typeof KNOWN_GAPS)[number] | undefined {
  return KNOWN_GAPS.find(
    (gap) =>
      gap.symbol === failure.symbol &&
      gap.property === failure.property &&
      failure.caseLabel.startsWith(gap.caseLabel),
  );
}

let ALL_FAILURES: Failure[] = [];
let TOTAL_RUNS = 0;

beforeAll(async () => {
  for (const contract of REGISTRY) {
    const runs = await runContract(contract);
    TOTAL_RUNS += runs.length;
    ALL_FAILURES = [...ALL_FAILURES, ...failuresFor(contract, runs)];
  }
});

describe('executable contracts', () => {
  it('drives a real corpus, so an empty run cannot pass', () => {
    expect(REGISTRY.length).toBeGreaterThan(0);
    expect(TOTAL_RUNS).toBeGreaterThan(100);
  });

  it('breaches no contract that is not a recorded gap', () => {
    const unexpected = ALL_FAILURES.filter((failure) => gapFor(failure) === undefined).map(
      (failure) =>
        `${failure.property} ${failure.symbol} — ${failure.caseLabel}: ${failure.detail}`,
    );
    expect(unexpected).toEqual([]);
  });

  it('records no gap that has stopped reproducing', () => {
    const stale = KNOWN_GAPS.filter(
      (gap) => !ALL_FAILURES.some((failure) => gapFor(failure) === gap),
    ).map((gap) => `${gap.finding} ${gap.symbol} ${gap.property} ${gap.caseLabel} no longer fails`);
    expect(stale).toEqual([]);
  });
});

describe('the registry covers the public surface', () => {
  it('names only entry points that exist at runtime', () => {
    const missing = PUBLIC_ENTRY_POINTS.filter((symbol) => {
      const member = symbol.slice('AmazonS3Vectors.'.length);
      return (
        !Object.getOwnPropertyNames(AmazonS3Vectors.prototype).includes(member) &&
        !Object.getOwnPropertyNames(AmazonS3Vectors).includes(member)
      );
    });
    expect(missing).toEqual([]);
  });

  it('accounts for every public entry point as registered or pending', () => {
    const registered = REGISTRY.map((contract) => contract.symbol);
    const accounted = new Set([...registered, ...PENDING_ENTRY_POINTS]);
    const unaccounted = PUBLIC_ENTRY_POINTS.filter((symbol) => !accounted.has(symbol));
    expect(unaccounted).toEqual([]);
  });

  it('lists nothing as pending that is already registered', () => {
    const registered = new Set(REGISTRY.map((contract) => contract.symbol));
    expect(PENDING_ENTRY_POINTS.filter((symbol) => registered.has(symbol))).toEqual([]);
  });
});

describe('P6 checks what it claims to', () => {
  const contract = {
    symbol: 'Probe.call',
    guarantees: ['does-not-mutate-inputs', 'fresh-arrays'],
  } as unknown as EntryPointContract<unknown>;
  const resolvedWith = (value: unknown): Outcome => ({
    settled: 'resolved',
    value,
    error: undefined,
    effects: { commands: [], peakConcurrency: 0, embedCalls: 0 },
  });

  it('reports an input the call changed', () => {
    const input = { ids: ['a'] };
    const before = fingerprint(input);
    input.ids.push('b');
    const failures = checkGuarantees(
      contract,
      { label: 'mutated', input, ambient: { label: 'benign' } },
      resolvedWith(undefined),
      before,
    );
    expect(failures.map((failure) => failure.detail)).toEqual(['changed its input']);
  });

  it('reports an array handed back that the caller passed in', () => {
    const ids = ['a'];
    const input = [[], { ids }];
    const failures = checkGuarantees(
      contract,
      { label: 'aliased', input, ambient: { label: 'benign' } },
      resolvedWith(ids),
      fingerprint(input),
    );
    expect(failures.map((failure) => failure.detail)).toEqual([
      'returned an array the caller passed in',
    ]);
  });

  it('tells every value in the corpus apart, so a change between two of them cannot hide', () => {
    const renderings = HOSTILE_VALUES.map((value) => fingerprint(value.make()));
    expect(new Set(renderings).size).toBe(renderings.length);
  });
});
