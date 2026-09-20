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

/**
 * Set an own, enumerable property, whatever the key is called.
 *
 * Accepts: the object to write to, a key that may be any string a caller's
 * data contained, and the value.
 *
 * Returns: nothing.
 *
 * Throws: nothing, for a plain extensible target.
 *
 * Guarantees: `defineProperty`, never assignment. `target[key] = value` for
 * `key === '__proto__'` does not write a property at all — it runs the setter
 * inherited from `Object.prototype`, which stores nothing and, for an object
 * or `null` value, replaces the target's prototype instead. `Object.hasOwn`
 * then still reports `false`, so a guard written around it does not fire
 * either. Both halves have bitten this package: once discarding every
 * document's page content, once silently dropping a metadata field while
 * handing the caller an object whose prototype was their own data.
 *
 * It lives here rather than beside one of its callers because there are two,
 * in different modules, and the fix in one is worthless without the other.
 */
export function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
