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

  // ── F-08 · a value that is not an AbortSignal is silently accepted ───────
  //
  // Wider than the audit recorded. F-08 names `raceAbort`, which is the
  // retriever's path and throws a raw TypeError there. `delete` reaches
  // `checkAborted`, which reads `signal?.aborted`, finds `undefined`, and
  // carries on — then hands the value to the SDK as `abortSignal`. So the same
  // mistake is loud on one path and silent on another, and the silent one is
  // worse: the caller believes the call is cancellable and it is not.
  {
    finding: 'F-08',
    symbol: 'AmazonS3Vectors.delete',
    property: 'P2',
    caseLabel: 'signal = ',
    note:
      'Every non-signal value in the corpus is accepted. checkAborted must reject a value ' +
      'that is not AbortSignal-shaped, as rejectSignalInCallbacksSlot already recognises one.',
  },

  // ── F-08 · the same signal defect on the write path, louder and costlier ──
  //
  // `addVectors` threads the signal into `raceAbort`, which tests `signal ===
  // undefined` and otherwise calls `signal.addEventListener` — so a non-signal
  // throws a raw TypeError that surfaces as `UNEXPECTED_ERROR`, and does so
  // only *after* `GetIndex` has been spent. `null` is caught by the same branch,
  // which is why an optional field defaulted to null breaks a write here while
  // `delete` accepts it: the two paths disagree about what absence looks like.
  ...(['P1', 'P2'] as const).map((property): KnownGap => ({
    finding: 'F-08',
    symbol: 'AmazonS3Vectors.addVectors',
    property,
    caseLabel: 'options.signal = ',
    note:
      'raceAbort must treat null as absent and refuse a non-signal with VALIDATION before ' +
      'any AWS call, rather than throwing from addEventListener after GetIndex.',
  })),

  // ── F-08 · a null document escapes as a raw TypeError ────────────────────
  //
  // `resolveWriteIds` reads `doc.id` before anything has checked that the
  // element is an object at all, so `documents: [null]` fails with
  // "Cannot read properties of null (reading 'id')" — an un-coded escape from a
  // package whose stated guarantee is that every failure is an S3VectorsError.
  ...(['P1', 'P2'] as const).map((property): KnownGap => ({
    finding: 'F-08',
    symbol: 'AmazonS3Vectors.addVectors',
    property,
    caseLabel: 'documents = array of null',
    note: 'Each document must be checked to be an object before any field of it is read.',
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

  // ── F-31 · building the error message throws, replacing the error ─────────
  //
  // Found by the corpus, not by the audit. `limits.ts` correctly detects a
  // non-finite vector component and calls `fail()` — but the message
  // interpolates `${String(component)}`, and `String()` on a null-prototype
  // object throws "Cannot convert object to primitive value". So the
  // TypeError from formatting *replaces* the VALIDATION being reported, and
  // the caller is told UNEXPECTED_ERROR about a perfectly ordinary bad input.
  //
  // `describeValue` in shared/describe.ts already exists for exactly this and
  // is what validation.ts uses; limits.ts should use it too. Any other site
  // interpolating caller data with String() has the same hole.
  ...(['P1', 'P2'] as const).map((property): KnownGap => ({
    finding: 'F-31',
    symbol: 'AmazonS3Vectors.addVectors',
    property,
    caseLabel: 'vector component = null-prototype object',
    note:
      'Error messages must not throw while being built: use describeValue, never String(), ' +
      'on a value that came from the caller.',
  })),
];
