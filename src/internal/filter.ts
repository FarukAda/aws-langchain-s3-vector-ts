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
function articleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** Describe a rejected value for the message, without leaking its contents. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type !== 'object') return `${articleFor(type)} ${type}`;
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name !== undefined && name !== 'Object'
    ? `${articleFor(name)} ${name} instance`
    : 'a non-plain object';
}

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
          `received ${describe(value)}, which AWS's filter syntax does not accept.`,
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
