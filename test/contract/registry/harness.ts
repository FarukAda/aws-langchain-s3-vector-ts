import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../../../src/s3-vectors.js';
import type { AmazonS3VectorsConfig } from '../../../src/types.js';

/**
 * The AWS commands this package can issue, named as the contract names them.
 *
 * The registry declares an expected sequence of these per entry point, so a
 * call that grew an extra round trip — or lost one — fails rather than being
 * noticed later in a bill.
 */
export type CommandName =
  | 'GetIndex'
  | 'CreateIndex'
  | 'DeleteIndex'
  | 'PutVectors'
  | 'DeleteVectors'
  | 'GetVectors'
  | 'QueryVectors'
  | 'ListVectors';

const COMMAND_NAMES: readonly CommandName[] = [
  'GetIndex',
  'CreateIndex',
  'DeleteIndex',
  'PutVectors',
  'DeleteVectors',
  'GetVectors',
  'QueryVectors',
  'ListVectors',
];

/** What an invocation actually did, beyond what it returned. */
export interface Effects {
  /** AWS commands in dispatch order. */
  readonly commands: readonly CommandName[];
  /** The most requests in flight at once — how a concurrency cap is checked. */
  readonly peakConcurrency: number;
  /** Calls to the embeddings model, which is what makes "before the billable call" testable. */
  readonly embedCalls: number;
}

/** What an invocation produced. */
export interface Outcome {
  readonly settled: 'resolved' | 'rejected';
  readonly value: unknown;
  readonly error: unknown;
  readonly effects: Effects;
}

/**
 * Scripts one AWS call. Returning a value resolves it; throwing rejects it.
 *
 * Receives the command name and the input the command was constructed with, so
 * a condition can fail only a particular call in a sequence.
 */
export type Responder = (command: CommandName, input: Record<string, unknown>) => unknown;

/** How an ambient condition bends the world around the call under test. */
export interface Ambient {
  /** Named in every failure message, so a failing case says which world it ran in. */
  readonly label: string;
  /** Scripts the AWS client. Omitted, every command resolves with a benign response. */
  readonly respond?: Responder;
  /** Replaces the embeddings model. Omitted, a deterministic stub is used. */
  readonly embeddings?: () => EmbeddingsInterface;
  /** Extra store configuration for this condition. */
  readonly config?: Partial<AmazonS3VectorsConfig>;
}

const INDEX_FIXTURE = {
  vectorBucketName: 'test-bucket',
  indexName: 'test-index',
  indexArn: 'arn:aws:s3vectors:us-east-1:000000000000:bucket/test-bucket/index/test-index',
  creationTime: new Date('2026-01-01T00:00:00.000Z'),
  dataType: 'float32',
  dimension: 3,
  distanceMetric: 'cosine',
};

/** What a command resolves with when an ambient condition says nothing about it. */
function benignResponse(command: CommandName): unknown {
  switch (command) {
    case 'GetIndex':
      return { index: INDEX_FIXTURE };
    case 'QueryVectors':
      return { vectors: [], distanceMetric: 'cosine' };
    case 'GetVectors':
      return { vectors: [] };
    case 'ListVectors':
      return { vectors: [] };
    default:
      return {};
  }
}

/** The command name behind an SDK command instance, via its constructor name. */
function commandNameOf(command: object): CommandName {
  const constructorName = command.constructor.name;
  const found = COMMAND_NAMES.find((name) => constructorName === `${name}Command`);
  if (found === undefined) {
    throw new Error(`conformance harness: unrecognised AWS command "${constructorName}"`);
  }
  return found;
}

/** A fake client the store accepts: `resolveClient` checks `config.serviceId` by value. */
interface FakeClient {
  readonly config: { readonly serviceId: 'S3Vectors' };
  send(command: object, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/**
 * Build a store whose AWS calls and embedding calls are observable.
 *
 * Accepts: the ambient condition to run under, and any config overrides the
 * case needs.
 *
 * Returns: the store, plus `run` — which invokes an entry point and reports
 * what it returned *and* what it did.
 *
 * Throws: nothing. A constructor failure is reported as a rejected outcome by
 * {@link runAgainst}, because "the constructor threw" is an outcome a contract
 * may legitimately declare.
 */
export function createHarness(
  ambient: Ambient,
  overrides: Partial<AmazonS3VectorsConfig> = {},
): { store: AmazonS3Vectors; effects: () => Effects } {
  const commands: CommandName[] = [];
  let inFlight = 0;
  let peakConcurrency = 0;
  let embedCalls = 0;

  const client: FakeClient = {
    config: { serviceId: 'S3Vectors' },
    async send(command, options) {
      const name = commandNameOf(command);
      commands.push(name);
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      try {
        // Yield once, so genuinely concurrent dispatch is visible as overlap
        // rather than serialised by an immediately-resolved promise.
        await Promise.resolve();
        if (options?.abortSignal?.aborted === true) {
          throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
        }
        const input = (command as { input?: Record<string, unknown> }).input ?? {};
        return ambient.respond === undefined
          ? benignResponse(name)
          : (ambient.respond(name, input) ?? benignResponse(name));
      } finally {
        inFlight -= 1;
      }
    },
  };

  const embeddings: EmbeddingsInterface = ambient.embeddings?.() ?? {
    embedDocuments: async (texts: string[]) => {
      embedCalls += 1;
      return texts.map((_, i) => [i + 0.1, i + 0.2, i + 0.3]);
    },
    embedQuery: async () => {
      embedCalls += 1;
      return [0.1, 0.2, 0.3];
    },
  };

  // Count embed calls even when the ambient condition supplied the model.
  const counted: EmbeddingsInterface = {
    embedDocuments: async (texts: string[]) => {
      embedCalls += 1;
      return await embeddings.embedDocuments(texts);
    },
    embedQuery: async (text: string) => {
      embedCalls += 1;
      return await embeddings.embedQuery(text);
    },
  };

  const store = new AmazonS3Vectors(counted, {
    vectorBucketName: 'test-bucket',
    indexName: 'test-index',
    ...ambient.config,
    ...overrides,
    client: client as unknown as NonNullable<AmazonS3VectorsConfig['client']>,
  });

  return {
    store,
    effects: () => ({ commands: [...commands], peakConcurrency, embedCalls }),
  };
}

/**
 * Invoke one entry point and record both halves of what happened.
 *
 * Accepts: the ambient condition, any config overrides, and the call itself.
 *
 * Returns: the {@link Outcome} — how it settled, with what, and the effects it
 * produced. A synchronous throw and a rejected promise are reported
 * identically, because a caller cannot tell them apart through `await`.
 *
 * Throws: nothing. Reporting a failure *as data* is the whole point: the
 * properties need to inspect failures, not be stopped by them.
 */
export async function runAgainst(
  ambient: Ambient,
  overrides: Partial<AmazonS3VectorsConfig>,
  call: (store: AmazonS3Vectors) => Promise<unknown>,
): Promise<Outcome> {
  let effects: () => Effects = () => ({ commands: [], peakConcurrency: 0, embedCalls: 0 });
  try {
    const harness = createHarness(ambient, overrides);
    effects = harness.effects;
    const value = await call(harness.store);
    return { settled: 'resolved', value, error: undefined, effects: effects() };
  } catch (error: unknown) {
    return { settled: 'rejected', value: undefined, error, effects: effects() };
  }
}
