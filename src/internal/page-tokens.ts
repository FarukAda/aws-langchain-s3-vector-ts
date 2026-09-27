/**
 * Hides how a paginator notices that the service has sent it round in a circle.
 *
 * A conforming service never hands back a token it has already handed out:
 * that is a page already read, and following it is a loop that issues billable
 * requests and, for an enumeration, never ends. Replayed and cached responses —
 * from a custom endpoint, a proxy or a stubbed client — look exactly like that,
 * and not only as the same token twice in a row: two pages that point at each
 * other are the same loop.
 *
 * Remembering every token would catch any cycle, but an enumeration can run to
 * millions of pages, so this holds one. It is Brent's cycle detection: the
 * remembered token is replaced at every power of two, so a cycle of length λ
 * entered after μ pages is caught within μ + 2λ pages, in constant memory.
 */

/** Tracks the tokens one paginated read has followed. */
export interface PageTokenTracker {
  /**
   * Record the token about to be followed.
   *
   * Returns: `true` when that token has come round again — a page already
   * read — and `false` otherwise.
   */
  readonly repeats: (token: string) => boolean;
}

/**
 * Start tracking one paginated read.
 *
 * Returns: a tracker holding no token yet.
 *
 * Throws: nothing.
 */
export function trackPageTokens(): PageTokenTracker {
  let remembered: string | undefined;
  let power = 1;
  let sinceRemembered = 0;
  return {
    repeats: (token: string): boolean => {
      if (token === remembered) return true;
      sinceRemembered++;
      if (sinceRemembered === power) {
        remembered = token;
        power *= 2;
        sinceRemembered = 0;
      }
      return false;
    },
  };
}
