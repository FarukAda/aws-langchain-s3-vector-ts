/**
 * Hides what was actually thrown. JavaScript lets any value be thrown, and a
 * signal's `reason` is whatever `abort()` was given; everything past this
 * module may treat a failure as an `Error`.
 */
import { describeText, renderValue } from '../describe.js';
import { readProperty } from '../objects.js';

/** Detect an Error-like value by structure (cross-realm safe, avoids `instanceof`). */
function isError(value: unknown): value is Error {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof readProperty(value, 'name') === 'string' &&
    typeof readProperty(value, 'message') === 'string'
  );
}

/**
 * Normalise an unknown thrown value into an `Error`.
 *
 * Accepts: anything. JavaScript permits throwing any value, and a signal's
 * `reason` is whatever `abort()` was given.
 *
 * Returns: the value itself when it is already Error-shaped — tested by
 * structure (`name` and `message` are strings) rather than `instanceof`, so a
 * cross-realm error passes. Otherwise a new `Error` whose message is:
 * - a thrown string, stripped of control characters and bounded;
 * - an object's own string `message`, the same way, when it has one;
 * - anything else described by kind — `an object`, `null`, `42` — and never by
 *   content. A provider or middleware that rejects with a request or config
 *   object would otherwise put its headers or keys into the message, and from
 *   there into logs and traces, which is what every other message in this
 *   package is written to avoid.
 *
 * Throws: nothing. This runs inside error handling, where a second failure
 * would replace the real one; every read of the value is guarded.
 *
 * Guarantees: total, and non-lossy for Error-like input — the original is
 * returned, not copied, so its stack survives.
 */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  if (typeof value === 'string') return new Error(describeText(value));
  const message =
    typeof value === 'object' && value !== null ? readProperty(value, 'message') : undefined;
  return new Error(typeof message === 'string' ? describeText(message) : renderValue(value));
}
