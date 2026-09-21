import { describe, it, expect } from '@jest/globals';
import { Document } from '@langchain/core/documents';

import {
  assertBatchSize,
  assertDocumentObjects,
  assertIdsOption,
  assertIsArray,
  parseK,
  assertQueryText,
  rejectSignalInCallbacksSlot,
  validationError,
} from '../../src/internal/guards.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * One test per domain cell of the shared caller-input guards. Every one of
 * these is reachable only from an untyped caller or a cast — which is exactly
 * why they exist: without them the same input arrives as a raw `TypeError`, or
 * as an AWS round trip that fails for a reason the caller has to decode.
 */
const SCOPE = { vectorBucketName: 'b', indexName: 'i' } as const;

/** What a text search takes before its callbacks slot. */
const TEXT_SEARCH = ['query', 'k', 'filter'] as const;

const thrown = (fn: () => void): { code?: string; message: string; context?: unknown } => {
  try {
    fn();
    throw new Error('expected a throw');
  } catch (e: unknown) {
    return e as { code?: string; message: string };
  }
};

describe('validationError', () => {
  it('returns the error rather than throwing it, so a caller can throw from a closure', () => {
    const error = validationError('addVectors', SCOPE, 'boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.context).toMatchObject({ operation: 'addVectors', ...SCOPE });
  });
});

describe('assertIsArray', () => {
  it('accepts an array, including an empty one', () => {
    expect(() => {
      assertIsArray('op', SCOPE, 'ids', []);
    }).not.toThrow();
  });

  it.each([null, undefined, 'abc', 42, {}, new Map()])('rejects %p by name', (value) => {
    const error = thrown(() => {
      assertIsArray('op', SCOPE, 'ids', value);
    });
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toBe('ids must be an array.');
  });
});

describe('assertIdsOption', () => {
  it('accepts an omitted option — no ids is not an error', () => {
    expect(() => {
      assertIdsOption('op', SCOPE, undefined);
    }).not.toThrow();
  });

  it('rejects a string, the case that would otherwise write one key per character', () => {
    // 'abc' alongside three vectors passes a naive length check and is then
    // sliced and indexed exactly like an array.
    const error = thrown(() => {
      assertIdsOption('op', SCOPE, 'abc' as unknown as string[]);
    });
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });
});

describe('rejectSignalInCallbacksSlot', () => {
  it.each([
    ['undefined', undefined],
    ['a handler array', [{ handleLLMStart: () => undefined }]],
    ['a CallbackHandlerMethods object', { handleRetrieverStart: () => undefined }],
    ['an EventTarget', new EventTarget()],
    ['an AbortController', new AbortController()],
  ])('accepts %s, which is what actually appears in that slot', (_label, value) => {
    expect(() => {
      rejectSignalInCallbacksSlot('similaritySearch', SCOPE, value, TEXT_SEARCH);
    }).not.toThrow();
  });

  it('rejects an AbortSignal and names the slot it belongs in', () => {
    const error = thrown(() => {
      rejectSignalInCallbacksSlot(
        'similaritySearch',
        SCOPE,
        new AbortController().signal,
        TEXT_SEARCH,
      );
    });
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toContain('5th');
    expect(error.message).toContain('similaritySearch(query, k, filter, undefined, signal)');
  });

  it('names the slots of the method it is guarding, not those of a sibling', () => {
    // Two parameters before the callbacks slot put it third and the signal
    // fourth, which is `maxMarginalRelevanceSearch`.
    const error = thrown(() => {
      rejectSignalInCallbacksSlot(
        'maxMarginalRelevanceSearch',
        SCOPE,
        new AbortController().signal,
        ['query', 'options'],
      );
    });
    expect(error.message).toContain('as the 3rd argument');
    expect(error.message).toContain('as the 4th argument');
    expect(error.message).toContain(
      'maxMarginalRelevanceSearch(query, options, undefined, signal)',
    );
  });

  it('rejects a signal-shaped object from another realm, since this is not instanceof', () => {
    const foreign = { aborted: false, addEventListener: () => undefined };
    expect(() => {
      rejectSignalInCallbacksSlot('similaritySearch', SCOPE, foreign, TEXT_SEARCH);
    }).toThrow();
  });
});

describe('assertBatchSize', () => {
  it.each([1, 250, 500])('accepts %p within the operation limit', (size) => {
    expect(() => {
      assertBatchSize('addVectors', SCOPE, size, 500);
    }).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects %p, which cannot drive a chunking loop', (size) => {
    expect(
      thrown(() => {
        assertBatchSize('addVectors', SCOPE, size, 500);
      }).message,
    ).toBe('batchSize must be a positive integer');
  });

  it('rejects a size above the operation limit, naming the limit', () => {
    const error = thrown(() => {
      assertBatchSize('getByIds', SCOPE, 101, 100);
    });
    expect(error.message).toContain('101');
    expect(error.message).toContain('100');
  });
});

describe('parseK', () => {
  it.each([1, 4, 10_000])('accepts %p', (k) => {
    expect(() => {
      parseK('similaritySearch', SCOPE, k);
    }).not.toThrow();
  });

  it.each([0, -1, 2.5])('rejects %p', (k) => {
    expect(
      thrown(() => {
        parseK('similaritySearch', SCOPE, k);
      }).message,
    ).toBe('k must be a positive integer');
  });

  it("rejects a k above AWS's documented topK ceiling", () => {
    const error = thrown(() => {
      parseK('similaritySearch', SCOPE, 10_001);
    });
    expect(error.message).toContain('10000');
  });
});

describe('assertDocumentObjects names the document it refuses (R3)', () => {
  it('carries its position in the context', () => {
    const error = thrown(() => {
      assertDocumentObjects('addDocuments', SCOPE, [new Document({ pageContent: 'a' }), null]);
    });
    expect(error.message).toMatch(/^Document at index 1 is not an object/);
    expect(error.context).toEqual({
      operation: 'addDocuments',
      vectorBucketName: 'b',
      indexName: 'i',
      recordIndex: 1,
    });
  });
});

describe('validationError with a record', () => {
  it('puts the record on the context', () => {
    expect(
      validationError('addVectors', SCOPE, 'm', { recordIndex: 3, recordId: 'k' }).context,
    ).toEqual({
      operation: 'addVectors',
      vectorBucketName: 'b',
      indexName: 'i',
      recordIndex: 3,
      recordId: 'k',
    });
  });
});

describe('assertQueryText', () => {
  it.each([
    ['an ordinary string', 'space adventure'],
    ['an empty string, which the model decides about', ''],
    ['an ill-formed string, which never reaches AWS', 'x\ud800'],
  ])('accepts %s', (_label, query) => {
    expect(() => {
      assertQueryText('similaritySearch', SCOPE, query);
    }).not.toThrow();
  });

  it.each([
    ['undefined', undefined, 'undefined'],
    ['an array, as a repeated query-string parameter arrives', ['a', 'b'], 'an array'],
    ['a number', 42, 'a number'],
  ])('refuses %s', (_label, query, kind) => {
    const error = thrown(() => {
      assertQueryText('similaritySearch', SCOPE, query);
    });
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
    expect(error.message).toBe(
      `The query must be a string (received ${kind}). It is the text the embeddings model embeds.`,
    );
  });
});
