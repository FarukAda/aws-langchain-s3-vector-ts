/**
 * A high surrogate not followed by a low one, or a low surrogate not preceded
 * by a high one. Matched as code units — there is no `u` flag, which would make
 * the engine read a well-formed pair as one code point and a lone half as
 * nothing it can match.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Why S3 Vectors cannot receive this string, or `undefined` if it can.
 *
 * Accepts: any string.
 *
 * Returns: `undefined` when the string is well-formed UTF-16. Otherwise a clause
 * written to follow a subject that names the string at fault — "Metadata key
 * 'title' …", "The metadata value under key 'title' …", "Its pageContent …" —
 * rather than the key it was reached through, because the position below is an
 * offset into that string and into no other. The clause names the position of
 * the first unpaired surrogate and what it costs: S3 Vectors fails the whole
 * request that carries it with `SerializationException` ("UnknownError"),
 * wherever the string travels — a metadata key or value, a vector key, a filter,
 * an index tag (docs/evidence/string-encoding.md, T3-15).
 *
 * Throws: nothing.
 *
 * Guarantees: `String.prototype.isWellFormed` decides. The position is searched
 * for only once a string has already failed that check.
 */
export function unpairedSurrogateReason(value: string): string | undefined {
  if (value.isWellFormed()) return undefined;
  return (
    `contains an unpaired UTF-16 surrogate at position ${value.search(UNPAIRED_SURROGATE)}. ` +
    'S3 Vectors fails the whole request carrying one (SerializationException, "UnknownError"); ' +
    'text cut by UTF-16 code unit, which can split an emoji in half, is the usual cause'
  );
}
