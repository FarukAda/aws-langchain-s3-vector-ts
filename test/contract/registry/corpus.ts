import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import type { Ambient } from './harness.js';

/**
 * The shared hostile-input corpus.
 *
 * Every entry point draws from this one list rather than keeping its own, so a
 * value that broke one call is tried against every other call from then on.
 * That is the rule the audit's findings were bought with: `NaN` was found in
 * metadata, and nothing had ever sent it to `delete` or to a query vector.
 *
 * Appending is the only supported edit. A value is never removed because a
 * particular entry point finds it uninteresting — the point is that nobody
 * decides, per call, which hostile inputs are worth trying.
 */
export interface HostileValue {
  /** Named in every failure, so a failing case is identifiable without a debugger. */
  readonly label: string;
  /** Built fresh per use: several are mutable, and a shared instance would leak between cases. */
  readonly make: () => unknown;
}

export const HOSTILE_VALUES: readonly HostileValue[] = [
  { label: 'undefined', make: () => undefined },
  { label: 'null', make: () => null },
  { label: 'NaN', make: () => Number.NaN },
  { label: 'Infinity', make: () => Number.POSITIVE_INFINITY },
  { label: '-Infinity', make: () => Number.NEGATIVE_INFINITY },
  { label: 'zero', make: () => 0 },
  { label: 'negative', make: () => -1 },
  { label: 'fractional', make: () => 1.5 },
  { label: 'huge', make: () => 1e9 },
  { label: 'empty string', make: () => '' },
  { label: 'string', make: () => 'not-a-thing' },
  { label: 'numeric string', make: () => '3' },
  { label: 'lone surrogate', make: () => '\ud800' },
  { label: 'NUL in string', make: () => 'a\u0000b' },
  { label: 'true', make: () => true },
  { label: 'empty array', make: () => [] },
  { label: 'empty object', make: () => ({}) },
  // A hole is not `undefined`: `Array.prototype.every` skips it, which is how
  // a sparse array passes the metadata validator today (F-01).
  // eslint-disable-next-line no-sparse-arrays
  { label: 'array with hole', make: () => [1, , 3] as unknown },
  { label: 'array with undefined', make: () => [1, undefined, 3] },
  { label: 'nested array', make: () => [[1], [2]] },
  { label: 'array of null', make: () => [null] },
  { label: 'array of empty string', make: () => [''] },
  { label: 'array of number', make: () => [123] },
  { label: 'array with duplicate', make: () => ['dup', 'dup'] },
  { label: 'over-long string', make: () => 'x'.repeat(1025) },
  { label: '__proto__ key', make: () => ({ ['__proto__']: 'polluted' }) },
  { label: 'null-prototype object', make: () => Object.create(null) as unknown },
  { label: 'function', make: () => (): number => 1 },
  { label: 'symbol', make: () => Symbol('s') },
  { label: 'bigint', make: () => BigInt(1) },
  { label: 'date', make: () => new Date(0) },
  { label: 'extra keys', make: () => ({ ids: ['a'], unexpected: true }) },
  // Shapes the 2026-09-16 probes found AWS rejecting (T3-14, T3-15, T3-17).
  { label: 'mixed array', make: () => [1, 'a'] },
  { label: 'array of boolean', make: () => [true] },
  { label: 'lone low surrogate', make: () => '\udc00' },
  // Accepted wherever a string is: the pair, not either half of it.
  { label: 'surrogate pair', make: () => '😀' },
  { label: 'multi-key object', make: () => ({ a: 1, b: 2 }) },
];

/** An AWS-shaped rejection: the SDK identifies its exceptions by `name`. */
function awsException(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(`${name} from the conformance corpus`), {
    name,
    $metadata: { httpStatusCode, requestId: 'conformance-request-id' },
  });
}

/** An embeddings model that fails the way a provider outage does. */
function throwingEmbeddings(): EmbeddingsInterface {
  return {
    embedDocuments: async () => {
      throw new Error('embeddings provider is down');
    },
    embedQuery: async () => {
      throw new Error('embeddings provider is down');
    },
  };
}

/**
 * The ambient axis: conditions that are not arguments.
 *
 * An inputs-only corpus cannot reach an embeddings model that throws, a client
 * that rejects with a string, or a malformed response — which is where a third
 * of the audit's findings lived. These are the other half of the matrix.
 */
export const AMBIENTS: readonly Ambient[] = [
  { label: 'benign' },
  {
    label: 'throttled',
    respond: () => {
      throw awsException('TooManyRequestsException', 429);
    },
  },
  {
    label: 'access denied',
    respond: () => {
      throw awsException('AccessDeniedException', 403);
    },
  },
  {
    label: 'aws rejected',
    respond: () => {
      throw awsException('ValidationException', 400);
    },
  },
  {
    label: 'not found',
    respond: () => {
      throw awsException('NotFoundException', 404);
    },
  },
  {
    label: 'service unavailable',
    respond: () => {
      throw awsException('ServiceUnavailableException', 503);
    },
  },
  {
    label: 'unknown failure',
    respond: () => {
      throw new Error('something nobody classified');
    },
  },
  {
    label: 'non-Error rejection',
    respond: () => {
      // Legal in JavaScript, and the reason `cause` is not always an Error.
      // The rule that forbids this exists to catch it happening by accident;
      // here it *is* the condition under test, so it is thrown deliberately.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a thrown string';
    },
  },
  {
    label: 'malformed response: null vector',
    respond: (command) =>
      command === 'GetIndex' ? undefined : { vectors: [null], distanceMetric: 'cosine' },
  },
  {
    label: 'malformed response: no response object',
    respond: (command) => (command === 'GetIndex' ? undefined : null),
  },
  { label: 'embeddings throw', embeddings: throwingEmbeddings },
  {
    label: 'embeddings return the wrong count',
    embeddings: () => ({
      embedDocuments: async () => [[0.1, 0.2, 0.3]],
      embedQuery: async () => [0.1, 0.2, 0.3],
    }),
  },
  {
    label: 'relevanceScoreFn throws',
    config: {
      relevanceScoreFn: () => {
        throw new Error('score function blew up');
      },
    },
  },
  {
    label: 'quota exceeded',
    // Only from the two commands whose service model declares it
    // (`@aws-sdk/client-s3vectors@3.1136.0` `dist-types/commands/PutVectorsCommand.d.ts`,
    // and CreateIndexCommand.d.ts): thrown from every command, it would make a
    // contract declare a code its entry point cannot raise.
    respond: (command) => {
      if (command === 'PutVectors' || command === 'CreateIndex') {
        throw awsException('ServiceQuotaExceededException', 402);
      }
      return undefined;
    },
  },
  {
    label: 'kms disabled',
    // Declared by PutVectors, GetVectors, QueryVectors and DeleteVectors, and by
    // nothing else (each command's `@throws`, e.g.
    // `@aws-sdk/client-s3vectors@3.1136.0` `dist-types/commands/DeleteVectorsCommand.d.ts`).
    respond: (command) => {
      if (
        command === 'PutVectors' ||
        command === 'GetVectors' ||
        command === 'QueryVectors' ||
        command === 'DeleteVectors'
      ) {
        throw awsException('KmsDisabledException', 400);
      }
      return undefined;
    },
  },
  {
    label: 'timeout',
    // What the SDK's own HTTP handler raises for a timed-out, reset or broken
    // connection: a plain Error named TimeoutError, carrying no `$metadata`.
    respond: () => {
      throw Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
    },
  },
  { label: 'no embeddings model', embeddings: null },
  {
    label: 'embeddings return a zero vector',
    embeddings: () => ({
      embedDocuments: async (texts: string[]) => texts.map(() => [0, 0, 0]),
      embedQuery: async () => [0, 0, 0],
    }),
  },
  {
    label: 'embeddings return mixed dimensions',
    embeddings: () => ({
      embedDocuments: async (texts: string[]) =>
        texts.map((_, i) => (i === 0 ? [0.1, 0.2, 0.3] : [0.1, 0.2])),
      embedQuery: async () => [0.1, 0.2, 0.3],
    }),
  },
  {
    label: 'index metric differs',
    respond: (command) =>
      command === 'QueryVectors' ? { vectors: [], distanceMetric: 'euclidean' } : undefined,
  },
  {
    label: 'endless pagination',
    respond: (command) =>
      command === 'QueryVectors'
        ? { vectors: [], distanceMetric: 'cosine', nextToken: 'more' }
        : undefined,
  },
];
