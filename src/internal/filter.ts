import { describeValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import type { StoreScope } from './signals.js';

/**
 * The complete filter vocabulary, from
 * https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html
 */
const COMPARISON_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
]);
const LOGICAL_OPERATORS = new Set(['$and', '$or']);
/** Operators documented as taking a non-empty array. */
const NON_EMPTY_ARRAY_OPERATORS = new Set(['$in', '$nin']);

/**
 * True for a plain key/value object — an object literal or an
 * `Object.create(null)` dictionary — and false for arrays, `Map`/`Set`,
 * `Date`, class instances and primitives.
 *
 * Deliberately not `proto === Object.prototype`: an object literal built in
 * another realm (a `vm` context, a worker's structured clone, a JSDOM window)
 * carries that realm's `Object.prototype`, so an identity check rejects
 * perfectly valid filters. A plain object is recognised structurally instead.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/**
 * "a"/"an" for the given word, so a message never reads "a Error instance".
 * Letter-based rather than pronunciation-based: correct for the constructor
 * names this actually reaches.
 */
/**
 * Validate a metadata filter against the documented operator vocabulary.
 *
 * Accepts:
 * - `undefined` or `null` — no filter; accepted, and the search runs
 *   unfiltered. `null` is read as "not provided" because a config assembled at
 *   runtime defaults an absent field to it.
 * - a plain object of conditions, nested to any depth through `$and`/`$or`.
 *   Plain is tested by prototype shape, so an object from another realm (a
 *   `vm` context, a worker `postMessage`, `structuredClone`) passes while a
 *   class instance, `Map` or `Date` does not.
 *
 * Returns: nothing. Acceptance is the entire result.
 *
 * Throws: `VALIDATION`, naming the path and the rule, for an array, a
 * non-plain object, `{}`, an unknown `$`-prefixed key, an `$and`/`$or` whose
 * value is not a non-empty array, or an `$in`/`$nin` whose value is not a
 * non-empty array of primitives.
 *
 * Guarantees: nothing is refused here that AWS would have accepted. Every rule
 * is either documented (userguide `s3-vectors-metadata-filtering.html`) or
 * confirmed live — `{}`, a mistyped operator, an unknown `$`-prefixed key and
 * an empty `$in` are all rejected by the service too
 * (`docs/evidence/filter-validation.md`).
 *
 * And the local check is worth more here than almost anywhere else in this
 * package, because AWS's entire diagnosis is the string `"Invalid filter"`,
 * identical for all four of those cases. This one names the key, the path and
 * the rule.
 */
export function validateFilter(filter: unknown, operation: string, scope: StoreScope): void {
  if (filter === undefined || filter === null) return;

  const fail: (message: string) => never = (message) => {
    throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation, ...scope });
  };

  const validateConditions = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      fail(
        `filter${path} must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ` +
          'arrays are not a valid filter shape. Omit the filter argument entirely to search ' +
          'without filtering.',
      );
    }
    if (!isPlainObject(value)) {
      fail(
        `filter${path} must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ` +
          `received ${describeValue(value, 'a non-plain object')}, which AWS's filter syntax does not accept.`,
      );
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      fail(
        `filter${path} cannot be an empty object ({}) — AWS rejects this as an invalid filter. ` +
          'Omit the filter argument entirely to search without filtering.',
      );
    }

    for (const key of keys) {
      const entry = value[key];
      if (!key.startsWith('$')) {
        // A field name. Its value is either a literal or an operator object.
        if (isPlainObject(entry)) validateOperators(entry, `${path}.${key}`);
        continue;
      }
      if (COMPARISON_OPERATORS.has(key)) {
        fail(
          `filter${path} uses '${key}' where a field name belongs. A comparison operator ` +
            `applies to a field, as in { year: { ${key}: … } }; only ` +
            `${[...LOGICAL_OPERATORS].join(' and ')} may appear on their own.`,
        );
      }
      if (!LOGICAL_OPERATORS.has(key)) {
        fail(
          `filter${path} uses unknown operator '${key}'. Valid operators are ` +
            `${[...COMPARISON_OPERATORS, ...LOGICAL_OPERATORS].join(', ')}.`,
        );
      }
      if (!Array.isArray(entry) || entry.length === 0) {
        fail(`filter${path}.${key} must be a non-empty array of filters.`);
      }
      for (const [index, nested] of (entry as unknown[]).entries()) {
        validateConditions(nested, `${path}.${key}[${index}]`);
      }
    }
  };

  const validateOperators = (conditions: Record<string, unknown>, path: string): void => {
    for (const [key, entry] of Object.entries(conditions)) {
      if (!key.startsWith('$')) continue;
      if (!COMPARISON_OPERATORS.has(key) && !LOGICAL_OPERATORS.has(key)) {
        fail(
          `filter${path} uses unknown operator '${key}'. Valid operators are ` +
            `${[...COMPARISON_OPERATORS, ...LOGICAL_OPERATORS].join(', ')}.`,
        );
      }
      if (NON_EMPTY_ARRAY_OPERATORS.has(key) && (!Array.isArray(entry) || entry.length === 0)) {
        fail(`filter${path}.${key} must be a non-empty array.`);
      }
    }
  };

  validateConditions(filter, '');
}
