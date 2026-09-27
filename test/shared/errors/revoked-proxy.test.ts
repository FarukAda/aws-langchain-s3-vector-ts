import { describe, expect, it } from '@jest/globals';

import { isAbortError } from '../../../src/shared/errors/aws-abort.js';
import {
  classifyAwsError,
  isTransientNetworkFailure,
} from '../../../src/shared/errors/classify.js';
import { S3VectorsErrorCode } from '../../../src/shared/errors/error-code.js';
import { toError } from '../../../src/shared/errors/to-error.js';
import { wrapAwsError, wrapCallerError } from '../../../src/shared/errors/wrap-error.js';

/**
 * Every predicate and wrapper here runs inside a `catch`, on whatever was
 * thrown, and each promises to throw nothing. A revoked `Proxy` throws on any
 * property read, so it is the hardest value those promises face.
 */
const revoked = (): object => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
const SCOPE = { operation: 'similaritySearch', vectorBucketName: 'b', indexName: 'i' };

describe('error handling given a revoked Proxy', () => {
  it('isAbortError answers false', () => {
    expect(isAbortError(revoked())).toBe(false);
  });

  it('classifyAwsError answers AWS_REQUEST_FAILED', () => {
    expect(classifyAwsError(revoked())).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
  });

  it('isTransientNetworkFailure answers false', () => {
    expect(isTransientNetworkFailure(revoked())).toBe(false);
  });

  it('toError returns an Error', () => {
    expect(toError(revoked())).toBeInstanceOf(Error);
  });

  it('wrapAwsError and wrapCallerError return coded errors', () => {
    expect(
      wrapAwsError(revoked(), S3VectorsErrorCode.AWS_REQUEST_FAILED, 'QueryVectors', SCOPE).code,
    ).toBe(S3VectorsErrorCode.AWS_REQUEST_FAILED);
    expect(wrapCallerError(revoked(), SCOPE).code).toBeDefined();
  });
});
