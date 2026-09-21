import { GetIndexCommand, PutVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import { isS3VectorsError, type S3VectorsError } from '../src/shared/errors/s3-vectors-error.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings, indexFixture } from './helpers.js';

/**
 * Every failure that leaves this package is an `S3VectorsError` (F-02, F-08).
 *
 * That is the guarantee README and the guide both state, and the reason a
 * caller is told to branch on `isS3VectorsError`. The write path honoured it —
 * an `embedDocuments` that throws comes back coded — while every read path let
 * the same failure through untouched. (Both are `EMBEDDINGS_FAILED` now: the
 * model's failure has a code of its own, apart from a bug in other caller code.) So the single most
 * likely production failure on a read, the embeddings provider rate-limiting or
 * falling over, was the one case a `catch` written against the documented
 * contract would miss.
 *
 * The rest of the holes are the same shape: a nullish argument, a value that is
 * not the `AbortSignal` it claims to be, a response carrying `null` where a
 * vector belongs, and an error message that throws while being built.
 */

/** An embeddings model that fails the way a provider outage does. */
function failingEmbeddings(message = 'embed down'): EmbeddingsInterface {
  return {
    embedDocuments: async () => {
      throw new Error(message);
    },
    embedQuery: async () => {
      throw new Error(message);
    },
  };
}

/** An embeddings model that throws a given value instead of resolving. */
function embeddingsThrowing(error: unknown): EmbeddingsInterface {
  return {
    embedDocuments: async () => {
      throw error;
    },
    embedQuery: async () => {
      throw error;
    },
  };
}

function seededStore(embeddings: EmbeddingsInterface, extra = {}): AmazonS3Vectors {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).resolves({ index: indexFixture() });
  mock.on(PutVectorsCommand).resolves({});
  mock.on(QueryVectorsCommand).resolves({
    vectors: [{ key: 'id-1', metadata: { _page_content: 'first' }, distance: 0.25 }],
    distanceMetric: 'cosine',
  });
  return new AmazonS3Vectors(embeddings, { ...BASE_CONFIG, ...extra, client });
}

/** Run `call` and return the coded error it raised, failing if it raised none. */
async function codedFailure(call: () => Promise<unknown>): Promise<S3VectorsError> {
  try {
    await call();
  } catch (error: unknown) {
    if (isS3VectorsError(error)) return error;
    throw new Error(
      `expected an S3VectorsError, got ${String((error as { name?: string })?.name)}: ${String(
        (error as { message?: string })?.message,
      )}`,
      { cause: error },
    );
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('an embeddings failure is coded on every read path, as it already is on write', () => {
  const reads: [string, (store: AmazonS3Vectors) => Promise<unknown>][] = [
    ['similaritySearch', async (store) => store.similaritySearch('q', 2)],
    ['similaritySearchWithScore', async (store) => store.similaritySearchWithScore('q', 2)],
    [
      'similaritySearchWithRelevanceScores',
      async (store) => store.similaritySearchWithRelevanceScores('q', 2),
    ],
    [
      'maxMarginalRelevanceSearch',
      async (store) => store.maxMarginalRelevanceSearch('q', { k: 1, fetchK: 2 }),
    ],
    ['retriever.invoke', async (store) => store.asRetriever(2).invoke('q')],
  ];

  it.each(reads)('%s wraps a throwing embedQuery', async (_label, call) => {
    const error = await codedFailure(async () => call(seededStore(failingEmbeddings())));
    expect(error.code).toBe(S3VectorsErrorCode.EMBEDDINGS_FAILED);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe('embed down');
  });

  it('addDocuments already did this, and still does', async () => {
    const error = await codedFailure(async () =>
      seededStore(failingEmbeddings()).addDocuments([new Document({ pageContent: 'a' })]),
    );
    expect(error.code).toBe(S3VectorsErrorCode.EMBEDDINGS_FAILED);
  });

  it('wraps a relevanceScoreFn that throws', async () => {
    const store = seededStore(createMockEmbeddings(), {
      relevanceScoreFn: () => {
        throw new Error('score fn blew up');
      },
    });
    const error = await codedFailure(async () => store.similaritySearchWithRelevanceScores('q', 1));
    expect(error.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
  });
});

describe('a caller-code failure never picks up AWS diagnostics it did not earn', () => {
  it('a network-coded embeddings failure through similaritySearch has no awsErrorName or retryable', async () => {
    const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    const error = await codedFailure(async () =>
      seededStore(embeddingsThrowing(networkError)).similaritySearch('q', 2),
    );
    expect(error.code).toBe(S3VectorsErrorCode.EMBEDDINGS_FAILED);
    expect(error.context.awsErrorName).toBeUndefined();
    expect(error.context.retryable).toBeUndefined();
  });

  it('a network-coded embeddings failure through addDocuments has no awsErrorName or retryable', async () => {
    const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    const error = await codedFailure(async () =>
      seededStore(embeddingsThrowing(networkError)).addDocuments([
        new Document({ pageContent: 'a' }),
      ]),
    );
    expect(error.code).toBe(S3VectorsErrorCode.EMBEDDINGS_FAILED);
    expect(error.context.awsErrorName).toBeUndefined();
    expect(error.context.retryable).toBeUndefined();
  });

  it('a thrown …Exception with $metadata from a model still carries AWS diagnostics', async () => {
    // An AWS-SDK-based embeddings model (Bedrock, say) can legitimately throw
    // one of these — unlike a bare Node.js system error code, this is
    // genuinely about AWS either way, so it is still reported.
    const sdkShaped = Object.assign(new Error('throttled'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    const error = await codedFailure(async () =>
      seededStore(embeddingsThrowing(sdkShaped)).similaritySearch('q', 2),
    );
    expect(error.code).toBe(S3VectorsErrorCode.EMBEDDINGS_FAILED);
    expect(error.context.awsErrorName).toBe('ThrottlingException');
    expect(error.context.retryable).toBe(true);
  });
});

describe('a nullish argument is refused, not dereferenced', () => {
  it('the constructor refuses a missing config', () => {
    expect(
      () =>
        // A cast, because the type already forbids this — the check is for the
        // untyped caller, or a config assembled at runtime that came back empty.
        new AmazonS3Vectors(createMockEmbeddings(), undefined as unknown as never),
    ).toThrow(/config/i);
  });

  it('maxMarginalRelevanceSearch refuses missing options', async () => {
    const store = seededStore(createMockEmbeddings());
    const error = await codedFailure(async () =>
      store.maxMarginalRelevanceSearch('q', undefined as unknown as never),
    );
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('asRetriever reads null fields as no options, as every options bag does', () => {
    const store = seededStore(createMockEmbeddings());
    const retriever = store.asRetriever(null as unknown as never);
    expect(retriever.k).toBe(4);
    expect(retriever.searchType).toBe('similarity');
    expect(retriever.tags).toEqual(['amazonS3Vectors']);
  });

  it('asRetriever refuses a fields argument that is neither a number nor an object', () => {
    const store = seededStore(createMockEmbeddings());
    for (const fields of ['k=4', [4], true]) {
      expect(() => store.asRetriever(fields as unknown as never)).toThrow(
        expect.objectContaining({ code: S3VectorsErrorCode.VALIDATION }),
      );
    }
  });
});

describe('a value that is not an AbortSignal is refused', () => {
  it.each([
    ['a string', 'not-a-signal'],
    ['an empty object', {}],
    ['a number', 7],
  ])('delete refuses %s in signal', async (_label, signal) => {
    const store = seededStore(createMockEmbeddings());
    const error = await codedFailure(async () =>
      store.delete({ ids: ['k1'], signal: signal as unknown as AbortSignal }),
    );
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('addVectors refuses a non-signal before spending an AWS call', async () => {
    const store = seededStore(createMockEmbeddings());
    const error = await codedFailure(async () =>
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })], {
        signal: 'nope' as unknown as AbortSignal,
      }),
    );
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('treats a null signal as absent, the same as every other optional field', async () => {
    const store = seededStore(createMockEmbeddings());
    await expect(
      store.addVectors([[0.1, 0.2, 0.3]], [new Document({ pageContent: 'a' })], {
        signal: null as unknown as AbortSignal,
      }),
    ).resolves.toHaveLength(1);
  });
});

describe('a malformed response is reported, not dereferenced', () => {
  it('a null entry in the vectors array is AWS_INVALID_RESPONSE', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      vectors: [null] as unknown as [],
      distanceMetric: 'cosine',
    });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const error = await codedFailure(async () => store.similaritySearch('q', 1));
    expect(error.code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
  });

  it('a non-array vectors member is AWS_INVALID_RESPONSE', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({
      vectors: 'not an array' as unknown as [],
      distanceMetric: 'cosine',
    });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const error = await codedFailure(async () => store.similaritySearch('q', 1));
    expect(error.code).toBe(S3VectorsErrorCode.AWS_INVALID_RESPONSE);
    expect(error.message).toMatch(/non-array/);
  });
});

describe('a document that is not an object is refused', () => {
  it('addVectors refuses a null document', async () => {
    const store = seededStore(createMockEmbeddings());
    const error = await codedFailure(async () =>
      store.addVectors([[0.1, 0.2, 0.3]], [null as unknown as Document]),
    );
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('building an error message never replaces the error', () => {
  it('reports a null-prototype vector component as VALIDATION', async () => {
    // `String()` on a null-prototype object throws "Cannot convert object to
    // primitive value", so formatting the message destroyed the message. The
    // caller was told UNEXPECTED_ERROR about an ordinary bad input.
    const store = seededStore(createMockEmbeddings());
    const error = await codedFailure(async () =>
      store.addVectors(
        [[0.1, Object.create(null) as number, 0.3]],
        [new Document({ pageContent: 'a' })],
      ),
    );
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toMatch(/finite/i);
  });
});

describe('cause is always an Error, as the class documents', () => {
  it('normalises a client that rejects with a string', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).rejects('a thrown string');
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });

    const error = await codedFailure(async () => store.similaritySearch('q', 1));
    expect(error.cause).toBeInstanceOf(Error);
  });
});
