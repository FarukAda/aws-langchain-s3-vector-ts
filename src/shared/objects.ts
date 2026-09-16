/**
 * Whether a value is an object that is not an array.
 *
 * Accepts: anything.
 *
 * Returns: `true` for any non-null object other than an array — a `Date`, a
 * `Map`, a class instance and an object literal alike.
 *
 * Throws: nothing.
 *
 * Guarantees: this is the check for "did the caller pass a bag of options at
 * all", where the question is whether properties can be read off it, not what
 * kind of object it is. Use {@link isPlainObject} where the value is data that
 * has to survive serialisation.
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a *plain* object — data, not an instance of something.
 *
 * Accepts: anything.
 *
 * Returns: `true` for an object literal, an object from `JSON.parse`, and one
 * created with a `null` prototype. `false` for an array, a `Date`, a `Map`, a
 * `RegExp` and any class instance.
 *
 * Throws: nothing.
 *
 * Guarantees: deliberately not `proto === Object.prototype`. An object literal
 * built in another realm — a `vm` context, a worker's structured clone, a JSDOM
 * window — carries that realm's `Object.prototype`, so an identity check would
 * reject a perfectly valid value. The shape is recognised structurally instead.
 *
 * This is stricter than {@link isObjectLike} on purpose, and the two lived as
 * four separate copies of "isPlainObject" across this package — two strict, two
 * loose, under one name. A reader could not tell which behaviour a call site
 * had, and neither could a reviewer: the names agreed while the semantics did
 * not. They are one module and two names now, so choosing between them is a
 * decision rather than an accident of which file you happened to be in.
 *
 * Use this where the value is data that will be serialised and stored — a
 * metadata object, a filter — and {@link isObjectLike} where it is merely a bag
 * of options to read from.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}
