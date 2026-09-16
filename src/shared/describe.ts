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

/**
 * Describe a rejected value by kind, never by content.
 *
 * Accepts: anything, including `null` and values from another realm.
 *
 * Returns: `'null'`, `'an array'`, `'a Map instance'`, `'a number'` — enough
 * for a caller to see what they passed, without echoing it. That matters
 * because these messages are written for options like `credentials`: an error
 * that printed the value would put a secret in a log line.
 *
 * `objectFallback` names the case the caller cannot distinguish: an object
 * whose constructor says nothing (`{}`, `Object.create(null)`, an object from
 * another realm). A filter rejection says "a non-plain object" there, because
 * "must be a plain object — received an object" reads like a contradiction.
 *
 * Throws: nothing. Reading `constructor.name` is guarded, so a null-prototype
 * object describes as an object rather than failing inside error handling.
 */
export function describeValue(value: unknown, objectFallback = 'an object'): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type !== 'object') return `${articleFor(type)} ${type}`;
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
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
  // Returned as literals rather than through `String()`: they read better as
  // themselves — "received undefined" against `describeValue`'s "received an
  // undefined" — and naming them avoids stringifying an `unknown` at all.
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
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
 * one is visible, and cut to 64 characters with `…` so a 1,024-character key
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
