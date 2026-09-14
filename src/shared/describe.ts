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
