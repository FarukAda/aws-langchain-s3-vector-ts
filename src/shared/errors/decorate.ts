import type { StoreScope } from '../scope.js';
import {
  isS3VectorsError,
  S3VectorsError,
  type S3VectorsErrorContext,
} from './s3-vectors-error.js';
import { wrapCallerError } from './wrap-error.js';

/**
 * Normalise `error` into an `S3VectorsError`, unchanged if it already is one.
 *
 * Accepts: any thrown value, the operation to name, and the scope to record —
 * `undefined` when no bucket or index is known yet, as for a store that failed
 * to construct.
 *
 * Returns: the value itself when it is already one of this library's errors —
 * so the layer nearest the failure keeps ownership of the message and the
 * class — and otherwise a new `UNEXPECTED_ERROR` carrying it as the cause.
 *
 * Throws: nothing.
 *
 * Guarantees: total. Every input yields an `S3VectorsError`, which is what lets
 * every decorator below assume one.
 *
 * `wrapCallerError`, not `wrapAwsError`: every AWS call in this package
 * already wraps its own failures before they reach one of this file's
 * callers (`settleGroup`/`writeFirstBatch` see only an already-wrapped
 * `S3VectorsError` from a failed `PutVectors`/`DeleteVectors`, which the
 * `isS3VectorsError` check above returns unchanged), so a value reaching the
 * wrapping branch here came from caller-supplied code (an `embedDocuments`
 * that threw) or from input that bypassed validation — never a bare AWS SDK
 * error. Neither is "an AWS request failed", and neither should pick up
 * `awsErrorName`/`retryable` from a Node.js system error code that happens to
 * match one of the SDK's own.
 */
function normalizeToS3VectorsError(
  error: unknown,
  operation: string,
  scope: StoreScope | undefined,
): S3VectorsError {
  return isS3VectorsError(error) ? error : wrapCallerError(error, { operation, ...scope });
}

/**
 * Rebuild `base` with a new message and context, keeping its stack.
 *
 * Accepts: an existing error, the message and context to replace.
 *
 * Returns: a new error — `message` and `context` are readonly once set, so
 * every decorator has to construct one — carrying `base`'s frames under its own
 * header line.
 *
 * Throws: nothing, whatever `base` carries.
 *
 * Guarantees: the stack still points at the code that actually failed. A fresh
 * `Error` captures a fresh stack, which made the decorator the apparent origin:
 * an abort raised in `checkAborted` reported `at attachPartialIds` as its top
 * frame, hiding the one thing a stack exists to show.
 *
 * Falls back to the rebuilt error's own stack when `base` has none, when it is
 * not a string — reachable only through a value forging this package's brand,
 * and still not a reason to throw inside error handling — or when it is not in
 * the `\n    at ` frame format this splices on. No engine-specific format is
 * assumed to be present, only recognised.
 */
export function rebuildWithContext(
  base: S3VectorsError,
  message: string,
  context: S3VectorsErrorContext,
): S3VectorsError {
  const rebuilt = new S3VectorsError(message, base.code, context, base.cause);
  const stack: unknown = base.stack;
  if (typeof stack === 'string') {
    const framesStart = stack.indexOf('\n    at ');
    if (framesStart !== -1) {
      rebuilt.stack = `${rebuilt.name}: ${message}${stack.slice(framesStart)}`;
    }
  }
  return rebuilt;
}

/**
 * Report a failure as the error of the public method the caller invoked.
 *
 * Accepts: any thrown value; that method (`"retriever.invoke"`,
 * `"fromDocuments"`, or one of several concurrent callers sharing one index
 * check); and the bucket and index to name should the value not be one of this
 * package's errors — `undefined` when none is known yet.
 *
 * Returns: the error itself when it already names `operation` — nothing to
 * rebuild. Otherwise a new error naming `operation`, with the same class, code
 * and cause, every other context field (a non-enumerable `instance` included,
 * still non-enumerable), and — through {@link rebuildWithContext} — the stack
 * of the code that actually failed. A value that is not one of this package's
 * errors is first wrapped as `UNEXPECTED_ERROR` under `operation`: whatever
 * reaches a caller is coded, whichever path it took.
 *
 * The message changes only where it reports the operation: a message built
 * around the operation's name leads with it, followed by a space —
 * `"addDocuments failed on PutVectors (…): …"`, `"similaritySearch was
 * aborted."`. That leading name is swapped, and everything after it — a
 * decoration such as the ids already written included — is kept. A message
 * that does not lead with the old name is kept whole, as is a method's call
 * signature quoted inside one as a remedy, which names what to call rather
 * than what was called.
 *
 * Throws: nothing.
 *
 * Guarantees: the original is never mutated. Its context and message are
 * readonly, and whoever else holds it — the first of several callers sharing
 * one failure — must go on seeing what it reported.
 */
export function attachOperation(
  error: unknown,
  operation: string,
  scope?: StoreScope,
): S3VectorsError {
  const base = normalizeToS3VectorsError(error, operation, scope);
  const previous = base.context.operation;
  if (previous === operation) return base;

  // Descriptors, not a spread: a spread would drop the non-enumerable
  // `instance` a factory attached for recovery.
  const context = Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(base.context),
      operation: { value: operation, enumerable: true },
    },
  ) as S3VectorsErrorContext;
  const message = base.message.startsWith(`${previous} `)
    ? `${operation}${base.message.slice(previous.length)}`
    : base.message;
  return rebuildWithContext(base, message, context);
}

/**
 * Attach the ids a partial batch operation already committed.
 *
 * Accepts: the thrown value, the operation, which list it is (`writtenIds` or
 * `deletedIds`), the ids confirmed before the failure, and optionally every id
 * the call resolved.
 *
 * Returns: the normalised error with `context[contextField]` set, and — when any id was
 * committed — a message saying how many, so a log line alone says whether the
 * operation was partial.
 *
 * Throws: nothing.
 *
 * Guarantees: progress is never silently lost. This matters most for
 * auto-generated write ids, which have no other way to be discovered again;
 * `attemptedIds` lets a retry overwrite in place rather than mint fresh UUIDs
 * for the documents that already landed.
 */
export function attachPartialIds(
  error: unknown,
  operation: string,
  scope: StoreScope,
  contextField: 'writtenIds' | 'deletedIds',
  ids: string[],
  attemptedIds?: readonly string[],
): S3VectorsError {
  const base = normalizeToS3VectorsError(error, operation, scope);
  const phrase =
    contextField === 'writtenIds' ? 'were already durably written' : 'were already durably deleted';
  const message =
    ids.length > 0
      ? `${base.message} ${ids.length} vector(s) ${phrase} before this failure — see error.context.${contextField}.`
      : base.message;
  return rebuildWithContext(base, message, {
    ...base.context,
    [contextField]: ids,
    ...(attemptedIds === undefined ? {} : { attemptedIds: [...attemptedIds] }),
  });
}

/**
 * Attach extra diagnostic context to a failure.
 *
 * Accepts: the thrown value, the operation and scope to name if it is not
 * already one of this package's errors, and the fields to add.
 *
 * Returns: the error with those fields merged into its context, keeping its
 * class, its message, its cause and — through {@link rebuildWithContext} — the
 * stack of whatever actually failed.
 *
 * Throws: nothing.
 */
export function attachContext(
  error: unknown,
  operation: string,
  scope: StoreScope,
  extra: Partial<S3VectorsErrorContext>,
): S3VectorsError {
  const base = normalizeToS3VectorsError(error, operation, scope);
  return rebuildWithContext(base, base.message, { ...base.context, ...extra });
}

/**
 * Attach the store a static factory had already constructed when it failed.
 *
 * Accepts: the thrown value, the factory the caller invoked, the scope, and the
 * instance.
 *
 * Returns: the error reported as that factory's, through
 * {@link attachOperation}, with `context.instance` set — so a caller can act on
 * `context.writtenIds` against the exact store the ids were written to, instead
 * of rebuilding an equivalent one from the same config by hand.
 *
 * Throws: nothing.
 *
 * Guarantees: the property is **non-enumerable**. It is a live handle for
 * programmatic recovery, not diagnostic data; enumerable, it rode along into
 * every `JSON.stringify(error.context)`, `util.inspect(error)` and structured
 * logger dump, pulling the SDK client into log output. Direct access
 * (`error.context.instance`) is unaffected.
 */
export function attachInstance<T extends object>(
  error: unknown,
  operation: string,
  scope: StoreScope,
  instance: T,
): S3VectorsError {
  const base = attachOperation(error, operation, scope);
  const context: S3VectorsErrorContext = { ...base.context };
  Object.defineProperty(context, 'instance', {
    value: instance,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return rebuildWithContext(base, base.message, context);
}
