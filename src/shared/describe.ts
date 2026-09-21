/**
 * The indefinite article for a word, for a message.
 *
 * Accepts: the word that follows it.
 *
 * Returns: `'an'` before a vowel, `'a'` otherwise — so a rejection reads "an
 * object" and "a number" rather than "a object". The rule is deliberately the
 * crude one: every word this is used on is a `typeof` result or a constructor
 * name, where initial-vowel spelling and pronunciation agree.
 *
 * Throws: nothing.
 */
function articleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** How much of a constructor name a message shows. */
const MESSAGE_NAME_MAX_LENGTH = 48;

/** How much of a metadata key a message shows. `context` carries nothing of it. */
const MESSAGE_KEY_MAX_LENGTH = 64;

/**
 * Remove the characters that let caller data forge a log record.
 *
 * A newline inside a value this package interpolates into a message puts a
 * second line into the application's log stream and its LangSmith traces, and
 * that line reads as its own record. C0 and DEL go; everything else — including
 * every non-ASCII character, which a legitimate key may well be — stays.
 */
function stripControl(text: string): string {
  // By code point rather than by regex. A character class holding control
  // characters is what `no-control-regex` exists to flag, and suppressing that
  // rule would have been the first disabled lint rule in `src/` — which the
  // source contract forbids, and cannot catch, because every suppression is a
  // comment. Iterating is also surrogate-safe, where a regex over code units
  // is not.
  let kept = '';
  for (const character of text) {
    // Compared as strings rather than as code points, which needs no
    // assertion that `codePointAt` found one: C0 is everything below the
    // space, and a surrogate pair starts at U+D800, so an astral character
    // sorts above the space and survives.
    if (character >= ' ' && character !== '\u007f') kept += character;
  }
  return kept;
}

/** Cut to `max` characters, marking that something was cut. */
function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A caller's metadata key, made safe to put in a message.
 *
 * Accepts: the key, as it came off the caller's object.
 *
 * Returns: it stripped of control characters and cut to
 * {@link MESSAGE_KEY_MAX_LENGTH}.
 *
 * Throws: nothing.
 *
 * Guarantees: bounded and single-line. A document's metadata key has no length
 * rule of its own here — AWS's 1–63 applies to an index's non-filterable keys,
 * not to a document's — and the per-key loop runs before the 2 KB and 40 KB
 * budgets, so a 200 KB key produced a 200,182-byte refusal carrying it
 * verbatim. In an ingest pipeline these keys are routinely derived from the
 * documents themselves — form field names, spreadsheet headers — so that is
 * caller content, at caller-chosen length, in somebody's logs.
 */
export function describeKey(key: string): string {
  return cut(stripControl(key), MESSAGE_KEY_MAX_LENGTH);
}

/**
 * A constructor name, made safe to put in a message.
 *
 * Accepts: whatever `constructor.name` turned out to be — which is caller data,
 * not a language guarantee: `{ constructor: { name: … } }` is an ordinary object
 * that arrives from `JSON.parse` of a request body, as a filter operand or as a
 * document's `pageContent`.
 *
 * Returns: the name with control characters removed and cut to
 * {@link MESSAGE_NAME_MAX_LENGTH}, or `undefined` when there is nothing usable
 * — not a string, or nothing left after stripping.
 *
 * Throws: nothing.
 *
 * Guarantees, and why each is here rather than assumed:
 * - **A string, checked.** `${name}` on an object with a null prototype raises
 *   "Cannot convert object to primitive value", and this runs while another
 *   error is being reported, so that replaces the caller's real failure with a
 *   formatting one.
 * - **No control characters.** A newline in a name puts a second line into the
 *   application's log stream and its traces, which reads as its own record.
 * - **Bounded.** Uncapped, 50 KB of name produced a 50 KB message from a few
 *   hundred bytes of request, which is a log-amplification lever.
 */
function safeName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const stripped = stripControl(name);
  if (stripped === '') return undefined;
  return cut(stripped, MESSAGE_NAME_MAX_LENGTH);
}

/**
 * Describe a rejected value by kind, never by content.
 *
 * Accepts: anything, including `null` and values from another realm.
 *
 * Returns: `'null'`, `'undefined'`, `'an array'`, `'a Map instance'`, `'a number'` — enough
 * for a caller to see what they passed, without echoing it. That matters
 * because these messages are written for options like `credentials`: an error
 * that printed the value would put a secret in a log line.
 *
 * `objectFallback` names the case the caller cannot distinguish: an object
 * whose constructor says nothing (`{}`, `Object.create(null)`, an object from
 * another realm). A filter rejection says "a non-plain object" there, because
 * "must be a plain object — received an object" reads like a contradiction.
 *
 * Throws: nothing. Every way of reading `constructor.name` that can fail is
 * guarded — it may be absent, it may not be a string, and on a hostile object
 * the getter itself may throw — so a null-prototype object or a crafted one
 * describes as an object rather than failing inside error handling. The name is
 * also stripped of control characters and capped; see {@link safeName} for why
 * a constructor name is caller data rather than a language guarantee.
 */
export function describeValue(value: unknown, objectFallback = 'an object'): string {
  if (value === null) return 'null';
  // Like `null`, a kind that is also a value, so it takes no article. It used
  // to fall through to the `typeof` wording below and read "received an
  // undefined" — on the likeliest first-run mistake there is, an environment
  // variable that was never set where a bucket name belongs.
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type !== 'object') return `${articleFor(type)} ${type}`;
  let raw: unknown;
  try {
    raw = (value as { constructor?: { name?: unknown } }).constructor?.name;
  } catch {
    // A throwing getter. The caller's failure is what matters, not this one.
    return objectFallback;
  }
  const name = safeName(raw);
  return name !== undefined && name !== 'Object'
    ? `${articleFor(name)} ${name} instance`
    : objectFallback;
}

/**
 * Render a value for a message: a number, boolean or bigint as itself,
 * anything else by kind.
 *
 * Accepts: anything, including a null-prototype object and a value from another
 * realm.
 *
 * Returns: `'0'`, `'NaN'`, `'true'` — the value itself where seeing it is what
 * makes the message useful and where it cannot be a secret — and otherwise
 * whatever {@link describeValue} says. "Vector dimension must be an integer
 * between 1 and 4096 (received 0)" tells a caller what to change; "(received a
 * number)" does not.
 *
 * Throws: nothing, which is the whole point of it existing. `String()` on an
 * object with a null prototype raises "Cannot convert object to primitive
 * value", so a message built that way can throw *while reporting another
 * error* and replace it — a plain `VALIDATION` about a bad vector component
 * reached the caller as `UNEXPECTED_ERROR` describing the formatting failure
 * instead of their input.
 *
 * Use this where the value is numeric and worth showing; use
 * {@link describeValue} where it might be a credential.
 */
export function renderValue(value: unknown): string {
  // `null` and `undefined` are not special here: `describeValue` names both as
  // themselves, which is what this wants for them too.
  //
  // Tested on `value` directly rather than on a stored `typeof`, so the type is
  // narrowed to the three that convert safely — which is also what proves to a
  // reader, and to the linter, that nothing here can reach `Object.toString`.
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return describeValue(value);
}

/** One element of a caller's list, by its position in the caller's own input. */
export interface RecordRef {
  /** The element's position, counted from 0 over the whole call — never over a batch. */
  readonly recordIndex: number;
  /** The element's id, when it has one that is a string. */
  readonly recordId?: string;
}

/** How much of an id a message shows. `context.recordId` always carries the whole id. */
const MESSAGE_ID_MAX_LENGTH = 64;

/**
 * The subject of a message about one element of a caller's list.
 *
 * Accepts: a noun — `'Document'`, `'Vector'`, `'Vector id'` — and the element's
 * reference.
 *
 * Returns: `Document at index 400 (id "ticket-400")`, or `Vector id at index 3`
 * when the reference carries no id. The id is JSON-quoted, so an empty or blank
 * one is visible, and cut to 64 characters with `…` so a 1,024-character id
 * does not swamp the message.
 *
 * Throws: nothing.
 */
export function describeRecord(noun: string, record: RecordRef): string {
  const subject = `${noun} at index ${record.recordIndex}`;
  if (record.recordId === undefined) return subject;
  const id =
    record.recordId.length > MESSAGE_ID_MAX_LENGTH
      ? `${record.recordId.slice(0, MESSAGE_ID_MAX_LENGTH)}…`
      : record.recordId;
  return `${subject} (id ${JSON.stringify(id)})`;
}
