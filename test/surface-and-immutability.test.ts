import { inspect } from 'node:util';

import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../src/shared/errors/error-code.js';
import {
  S3VectorsError,
  type S3VectorsErrorContext,
} from '../src/shared/errors/s3-vectors-error.js';
import { createTestStore } from './helpers.js';

/**
 * What a caller can see, and what they can change (F-15, F-21, F-26).
 *
 * TypeScript's `private` is a compile-time courtesy: it is erased, so every
 * field and method marked with it stayed an ordinary own property or prototype
 * member at runtime. That made three documented claims untrue at once.
 *
 * README states that the store "never keeps `credentials` or the SDK `client` in
 * any enumerable field". `_client` was an enumerable own property — the
 * credentials were unreachable through it by accident of how the SDK stores
 * them, not by design, and `Object.keys(store)` listed the handle regardless.
 *
 * `_selectRelevanceScoreFn` carried an `@internal` tag and `stripInternal`, so it
 * was absent from the published `.d.ts` while remaining callable at runtime and
 * documented by typedoc — and its own comment said `@langchain/core` calls it,
 * which core does not: this package's own
 * `similaritySearchWithRelevanceScores` does.
 *
 * And `S3VectorsError` documents `code` and `context` as "readonly once set",
 * which they were not: both could be reassigned, and `context` was stored as the
 * caller's own object, so whoever built the error could still rewrite it
 * afterwards.
 */

const INTERNAL_NAMES = [
  '_client',
  '_queryEmbeddings',
  '_relevanceScoreFn',
  '_lifecycle',
  '_nonFilterableKeys',
  '_scope',
  '_putBatch',
  '_textSearch',
  '_embedQuery',
  '_score',
  '_checkAborted',
  '_getQueryEmbeddings',
  '_getIndexEmbeddings',
  '_selectRelevanceScoreFn',
];

describe('the store exposes only what it documents', () => {
  it('keeps no internal in an enumerable own property', () => {
    const { store } = createTestStore();
    const own = Object.keys(store);
    expect(own.filter((name) => INTERNAL_NAMES.includes(name))).toEqual([]);
  });

  it('keeps no internal on the prototype', () => {
    const onPrototype = Object.getOwnPropertyNames(AmazonS3Vectors.prototype);
    expect(onPrototype.filter((name) => INTERNAL_NAMES.includes(name))).toEqual([]);
  });

  it('still exposes the public surface', () => {
    const { store } = createTestStore();
    expect(store.vectorBucketName).toBe('test-bucket');
    expect(store._vectorstoreType()).toBe('amazonS3Vectors');
    expect(typeof store.addVectors).toBe('function');
    expect(typeof store.similaritySearchWithRelevanceScores).toBe('function');
  });

  it('renders without any internal name at depth', () => {
    const { store } = createTestStore();
    const rendered = inspect(store, { depth: 6, showHidden: true });
    for (const name of INTERNAL_NAMES) expect(rendered).not.toContain(name);
  });
});

describe('a thrown error cannot be rewritten', () => {
  const build = (context: S3VectorsErrorContext): S3VectorsError =>
    new S3VectorsError('boom', S3VectorsErrorCode.VALIDATION, context);

  it('refuses to reassign code', () => {
    const error = build({ operation: 'op' });
    expect(() => {
      (error as unknown as { code: string }).code = 'HACKED';
    }).toThrow(TypeError);
    expect(error.code).toBe(S3VectorsErrorCode.VALIDATION);
  });

  it('refuses to reassign context', () => {
    const error = build({ operation: 'op' });
    expect(() => {
      (error as unknown as { context: unknown }).context = { operation: 'other' };
    }).toThrow(TypeError);
    expect(error.context.operation).toBe('op');
  });

  it('does not alias the context it was given', () => {
    const context: S3VectorsErrorContext = { operation: 'op', indexName: 'i' };
    const error = build(context);

    expect(error.context).not.toBe(context);
    expect(error.context).toEqual(context);
  });

  it('freezes its context, so a field cannot be edited in place', () => {
    const error = build({ operation: 'op', writtenIds: ['a'] });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(() => {
      (error.context as unknown as { operation: string }).operation = 'other';
    }).toThrow(TypeError);
  });

  it('keeps a non-enumerable context field non-enumerable through the copy', () => {
    // `context.instance` is defined non-enumerably so it stays out of logs. A
    // copy made by spreading would drop it entirely, which is why the copy is
    // made from property descriptors.
    const context: S3VectorsErrorContext = { operation: 'fromDocuments' };
    Object.defineProperty(context, 'instance', {
      value: { marker: true },
      enumerable: false,
      configurable: true,
      writable: false,
    });

    const error = build(context);

    expect(Object.keys(error.context)).not.toContain('instance');
    expect((error.context as unknown as { instance: { marker: boolean } }).instance.marker).toBe(
      true,
    );
    expect(JSON.stringify(error.context)).not.toContain('marker');
  });

  it('still lets a decorator build a new error from an old context', () => {
    // Every decorator rebuilds rather than mutates, so freezing must not stop
    // one from reading a context and constructing the next error from it.
    const first = build({ operation: 'op', writtenIds: ['a'] });
    const second = new S3VectorsError('again', first.code, {
      ...first.context,
      attemptedIds: ['a', 'b'],
    });

    expect(second.context.writtenIds).toEqual(['a']);
    expect(second.context.attemptedIds).toEqual(['a', 'b']);
  });
});

describe('the error constructor cannot be made to fail while reporting a failure', () => {
  it('tolerates a nullish context rather than throwing from inside the constructor', () => {
    // Reading property descriptors off `null` throws. This constructor runs while
    // something has already gone wrong, so a second failure here would replace
    // the one being reported — the same trap as a message that throws while being
    // built.
    const error = new S3VectorsError(
      'boom',
      S3VectorsErrorCode.UNEXPECTED_ERROR,
      undefined as unknown as S3VectorsErrorContext,
    );

    expect(error.code).toBe(S3VectorsErrorCode.UNEXPECTED_ERROR);
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(Object.keys(error.context)).toEqual([]);
  });
});
