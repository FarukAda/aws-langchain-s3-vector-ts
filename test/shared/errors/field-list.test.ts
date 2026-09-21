import { describe, it, expect } from '@jest/globals';

import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { wrapAwsError } from '../../../src/shared/errors/wrap-error.js';

/**
 * `ValidationException.fieldList` is a typed member of the SDK's exception
 * (`@aws-sdk/client-s3vectors@3.1136.0` `dist-types/models/errors.d.ts`), and
 * each entry is `{ path, message }` (`models_0.d.ts:94`). It names the field
 * AWS rejected, and was discarded.
 */
const SCOPE = { operation: 'addVectors', vectorBucketName: 'b', indexName: 'i' };

const validationException = (fieldList?: unknown): Error =>
  Object.assign(new Error('Invalid record'), {
    name: 'ValidationException',
    ...(fieldList === undefined ? {} : { fieldList }),
    $metadata: { httpStatusCode: 400, requestId: 'req-1' },
  });

const contextOf = (e: unknown): Record<string, unknown> =>
  (e as { context: Record<string, unknown> }).context;

describe('wrapAwsError — fieldList', () => {
  it('lifts fieldList onto the context so the caller learns which field failed', () => {
    const fieldList = [{ path: 'vectors[0].metadata', message: 'too large' }];
    const wrapped = wrapAwsError(
      validationException(fieldList),
      S3VectorsErrorCode.AWS_REJECTED,
      'PutVectors',
      SCOPE,
    );
    expect(contextOf(wrapped)['fieldList']).toEqual(fieldList);
  });

  it('carries every entry, because a field can fail more than one constraint', () => {
    const fieldList = [
      { path: 'vectors[0]', message: 'zero norm' },
      { path: 'vectors[0].metadata', message: 'too large' },
    ];
    const wrapped = wrapAwsError(
      validationException(fieldList),
      S3VectorsErrorCode.AWS_REJECTED,
      'PutVectors',
      SCOPE,
    );
    expect(contextOf(wrapped)['fieldList']).toHaveLength(2);
  });

  it('omits fieldList entirely when the exception carries none', () => {
    const wrapped = wrapAwsError(
      validationException(undefined),
      S3VectorsErrorCode.AWS_REJECTED,
      'PutVectors',
      SCOPE,
    );
    expect('fieldList' in contextOf(wrapped)).toBe(false);
  });

  it('omits a fieldList that is not an array, rather than passing a malformed shape through', () => {
    const wrapped = wrapAwsError(
      validationException('not-a-list'),
      S3VectorsErrorCode.AWS_REJECTED,
      'PutVectors',
      SCOPE,
    );
    expect('fieldList' in contextOf(wrapped)).toBe(false);
  });

  it('still lifts the other AWS diagnostics alongside it', () => {
    const wrapped = wrapAwsError(
      validationException([{ path: 'p', message: 'm' }]),
      S3VectorsErrorCode.AWS_REJECTED,
      'PutVectors',
      SCOPE,
    );
    const context = contextOf(wrapped);
    expect(context['awsErrorName']).toBe('ValidationException');
    expect(context['httpStatusCode']).toBe(400);
    expect(context['requestId']).toBe('req-1');
  });
});
