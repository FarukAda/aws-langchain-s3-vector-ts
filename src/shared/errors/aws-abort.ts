/**
 * How far to follow `cause` looking for an abort. Bounded because a cause
 * chain can be cyclic, and an unbounded walk inside error handling would
 * replace the real failure with a hang.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether `error` is, or wraps, the abort an `AbortSignal` produces.
 *
 * Accepts: any thrown value.
 *
 * Returns: `true` when the value or any `cause` within {@link MAX_CAUSE_DEPTH}
 * links carries `name === 'AbortError'`.
 *
 * Throws: nothing.
 *
 * Guarantees: terminates on a cyclic chain. The chain is walked because
 * `config.client` is a supported injection point: a custom request handler may
 * wrap its abort, and an unrecognised abort would be reported as a request
 * failure — a cancelled call reported as something that went wrong.
 */
export function isAbortError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { name?: unknown }).name === 'AbortError') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
