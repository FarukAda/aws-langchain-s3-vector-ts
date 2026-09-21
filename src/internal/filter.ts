/**
 * Hides the filter grammar.
 *
 * Which operators exist, which operands each one takes, how deep a filter may
 * nest and what a rejection says are one decision, answered here so that no call
 * site has to know the shape of a filter to pass one along. The grammar is the
 * service's; the refusals are this package's, because the service's own message
 * names neither the operator nor the reason.
 */
import { describeValue, renderValue } from '../shared/describe.js';
import { S3VectorsErrorCode } from '../shared/errors/error-code.js';
import { S3VectorsError } from '../shared/errors/s3-vectors-error.js';
import { isPlainObject } from '../shared/objects.js';
import type { StoreScope } from '../shared/scope.js';
import { unpairedSurrogateReason } from '../shared/utf16.js';

/** Why an operand cannot be used as written, or `undefined` if it can. */
type OperandRule = (operand: unknown) => string | undefined;

/**
 * Describe a refused operand for a message.
 *
 * A `Date` gets the remedy as well as its name: it is the value a caller
 * reaches for, and the one whose failure is least visible, because the AWS SDK
 * would send it as a timestamp (`@aws-sdk/core` `submodules/protocols`) and the
 * filter would compare against a number nobody wrote. Recognised by its
 * built-in tag rather than `instanceof`, so a `Date` from another realm counts.
 */
function describeOperand(operand: unknown): string {
  if (Object.prototype.toString.call(operand) === '[object Date]') {
    return (
      'a Date, which the AWS SDK would send as a timestamp — convert it yourself to the ' +
      'number or string the field was written with'
    );
  }
  return renderValue(operand);
}

/** Why a number cannot be sent as written — a non-finite one becomes a string — or `undefined`. */
function numberReason(operand: number): string | undefined {
  return Number.isFinite(operand)
    ? undefined
    : `is ${String(operand)}, which the AWS SDK sends as the string "${String(operand)}", so ` +
        'the filter would silently match nothing';
}

/**
 * `$eq`, `$ne` and the shorthand `{ field: value }`: a well-formed string, a
 * finite number or a boolean (docs/evidence/filter-validation.md, T3-16).
 *
 * A non-finite number and a `Date` are refused although S3 Vectors accepts what
 * they become, because what they become is not what was written (T3-19) — the
 * rule `shared/metadata.ts` applies, for the same reason.
 */
function scalarReason(operand: unknown): string | undefined {
  if (typeof operand === 'string') return unpairedSurrogateReason(operand);
  if (typeof operand === 'boolean') return undefined;
  if (typeof operand === 'number') return numberReason(operand);
  return `must be a string, a finite number or a boolean (received ${describeOperand(operand)})`;
}

/** `$gt`, `$gte`, `$lt`, `$lte`: a finite number (T3-16). */
function finiteNumberReason(operand: unknown): string | undefined {
  if (typeof operand === 'number') return numberReason(operand);
  return `must be a finite number (received ${describeOperand(operand)})`;
}

/**
 * `$in`, `$nin`: a non-empty array of operands `$eq` would take, with types
 * mixed freely (T3-16). The user guide's "non-empty array of primitives" does
 * not include `null`, although `null` is a JavaScript primitive.
 */
function scalarArrayReason(operand: unknown): string | undefined {
  if (!Array.isArray(operand)) {
    return `must be a non-empty array (received ${describeOperand(operand)})`;
  }
  if (operand.length === 0) return 'must be a non-empty array';
  for (let index = 0; index < operand.length; index++) {
    const reason = scalarReason(operand[index]);
    if (reason !== undefined) return `has an element at index ${index} that ${reason}`;
  }
  return undefined;
}

/** `$exists`: a boolean (T3-16). */
function booleanReason(operand: unknown): string | undefined {
  return typeof operand === 'boolean'
    ? undefined
    : `must be a boolean (received ${describeOperand(operand)})`;
}

/**
 * Every comparison operator S3 Vectors defines, with the operand it takes: the
 * complete vocabulary (userguide `s3-vectors-metadata-filtering.html`), each
 * rule confirmed against the live service (docs/evidence/filter-validation.md,
 * T3-16). A `Map`, so a key such as `constructor` can never be found on a
 * prototype.
 */
const OPERAND_RULES: ReadonlyMap<string, OperandRule> = new Map<string, OperandRule>([
  ['$eq', scalarReason],
  ['$ne', scalarReason],
  ['$gt', finiteNumberReason],
  ['$gte', finiteNumberReason],
  ['$lt', finiteNumberReason],
  ['$lte', finiteNumberReason],
  ['$in', scalarArrayReason],
  ['$nin', scalarArrayReason],
  ['$exists', booleanReason],
]);
const LOGICAL_OPERATORS = new Set(['$and', '$or']);

/**
 * How deep `$and`/`$or` may nest before the filter is refused.
 *
 * The check is recursive, and a filter is the one input a caller plausibly
 * builds from user data or from a model's output. Without a bound, around three
 * to four thousand levels — a few tens of kilobytes of JSON, which `JSON.parse`
 * handles happily because its own parser is iterative — exhausts the stack and
 * escapes as a raw `RangeError`. That is uncoded, so `isS3VectorsError` reports
 * `false` and a caller branching on the code falls through to its generic
 * handler, which is the one guarantee this package makes about every failure.
 *
 * 32 is past anything a person or a query builder writes and far below where
 * recursion is a problem. AWS's own nesting is shallower still.
 */
const MAX_FILTER_DEPTH = 32;
/** Every operator, in the order a message lists them. */
const ALL_OPERATORS = [...OPERAND_RULES.keys(), ...LOGICAL_OPERATORS].join(', ');
/** The comparison operators alone. */
const COMPARISON_OPERATORS = [...OPERAND_RULES.keys()].join(', ');

declare const parsedFilter: unique symbol;

/**
 * A metadata filter that has been checked against the grammar this module
 * defines.
 *
 * The only way to obtain one is {@link parseFilter}, so a function that asks
 * for a ParsedFilter cannot be handed a filter nobody checked. Those functions
 * used to ask for `unknown` and carry a comment saying "already validated by
 * the caller" — a promise the compiler cannot keep, and the reason the same
 * filter was checked twice on one path: a check that returns nothing throws
 * away what it learned at the moment it learned it.
 *
 * The brand is phantom. At run time the value is the caller's own filter
 * object, unchanged, and it is cast to the SDK's document type where the
 * request is built.
 */
export type ParsedFilter = { readonly [parsedFilter]: true };

/** Raise a `VALIDATION` naming the filter path that broke a rule. */
function failFilter(operation: string, scope: StoreScope, message: string): never {
  throw new S3VectorsError(message, S3VectorsErrorCode.VALIDATION, { operation, ...scope });
}

/** The message for a `$`-prefixed key that is no operator, wherever it stands. */
function unknownOperatorMessage(path: string, key: string): string {
  return `filter${path} uses unknown operator '${key}'. Valid operators are ${ALL_OPERATORS}.`;
}

/**
 * Check the operator object a field's condition is written as.
 *
 * Accepts: the object under a field name — `{ $eq: 'a' }`, `{ $gte: 1, $lte: 5 }`
 * — and its path.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` for an object with no keys; for `$and` or `$or`, which
 * combine whole conditions rather than a field's value; for an unknown
 * `$`-prefixed key; for a key that is not an operator at all; and for an operand
 * its operator does not take. AWS rejects every one of these
 * (docs/evidence/filter-validation.md, T3-16 and T3-18).
 */
function assertOperatorObject(
  conditions: Record<string, unknown>,
  path: string,
  operation: string,
  scope: StoreScope,
): void {
  const keys = Object.keys(conditions);
  if (keys.length === 0) {
    failFilter(
      operation,
      scope,
      `filter${path} is an empty object. Give the value itself, or at least one comparison ` +
        'operator such as { $eq: … }.',
    );
  }
  for (const key of keys) {
    const rule = OPERAND_RULES.get(key);
    if (rule !== undefined) {
      const reason = rule(conditions[key]);
      if (reason !== undefined) failFilter(operation, scope, `filter${path}.${key} ${reason}.`);
      continue;
    }
    if (LOGICAL_OPERATORS.has(key)) {
      failFilter(
        operation,
        scope,
        `filter${path} uses '${key}' inside a field's condition. Logical operators combine ` +
          `whole conditions: { ${key}: [{ field: … }, { field: … }] }.`,
      );
    }
    if (key.startsWith('$')) failFilter(operation, scope, unknownOperatorMessage(path, key));
    failFilter(
      operation,
      scope,
      `filter${path} holds '${key}', which is not an operator. A field's condition object ` +
        `holds only comparison operators (${COMPARISON_OPERATORS}); S3 Vectors rejects ` +
        'anything else in it.',
    );
  }
}

/**
 * Check the condition under one field name.
 *
 * Accepts: the value under a field — the value itself, which S3 Vectors compares
 * with an implicit `$eq`, or an object of comparison operators — and its path.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` for a value `$eq` would not take (T3-16, T3-19), and
 * whatever {@link assertOperatorObject} raises for an operator object.
 */
function assertFieldCondition(
  entry: unknown,
  path: string,
  operation: string,
  scope: StoreScope,
): void {
  if (isPlainObject(entry)) {
    assertOperatorObject(entry, path, operation, scope);
    return;
  }
  const reason = scalarReason(entry);
  if (reason !== undefined) failFilter(operation, scope, `filter${path} ${reason}.`);
}

/**
 * Check one `$and`/`$or` branch: a non-empty array of conditions.
 *
 * Accepts: the value under a logical operator, and its path.
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` for anything that is not a non-empty array, and
 * whatever each nested condition raises — recursing back through
 * {@link assertConditions}, which is what lets a branch hold another branch
 * rather than only field conditions. Depth is bounded by
 * {@link MAX_FILTER_DEPTH}, counted per logical level.
 */
function assertLogicalBranch(
  entry: unknown,
  key: string,
  path: string,
  operation: string,
  scope: StoreScope,
  depth: number,
): void {
  if (!Array.isArray(entry) || entry.length === 0) {
    failFilter(operation, scope, `filter${path}.${key} must be a non-empty array of filters.`);
  }
  for (const [index, nested] of (entry as unknown[]).entries()) {
    assertConditions(nested, `${path}.${key}[${index}]`, operation, scope, depth + 1);
  }
}

/**
 * Check one condition object: its shape, its single key, and what that key holds.
 *
 * Accepts: a value that must be a plain object with exactly one key, and the
 * path to report it under (`''` at the top level, `.$and[0]` inside a branch).
 *
 * Returns: nothing.
 *
 * Throws: `VALIDATION` for an array, a non-plain object, `{}`, more than one key
 * (T3-17), a comparison operator standing where a field name belongs, an unknown
 * `$`-prefixed key, a field name that is not well-formed UTF-16
 * (docs/evidence/string-encoding.md, T3-15), a malformed logical branch, or a
 * field condition S3 Vectors would refuse.
 */
function assertConditions(
  value: unknown,
  path: string,
  operation: string,
  scope: StoreScope,
  depth: number,
): void {
  if (depth > MAX_FILTER_DEPTH) {
    failFilter(
      operation,
      scope,
      `filter${path} nests logical operators more than ${MAX_FILTER_DEPTH} levels deep. ` +
        'A filter that deep is built by a program rather than written, and checking it ' +
        'recursively past this point exhausts the stack.',
    );
  }
  if (Array.isArray(value)) {
    failFilter(
      operation,
      scope,
      `filter${path} must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ` +
        'arrays are not a valid filter shape. Omit the filter argument entirely to search ' +
        'without filtering.',
    );
  }
  if (!isPlainObject(value)) {
    failFilter(
      operation,
      scope,
      `filter${path} must be a plain object of metadata conditions (e.g. { genre: "scifi" }) — ` +
        `received ${describeValue(value, 'a non-plain object')}, which AWS's filter syntax does ` +
        'not accept. Omit the filter argument entirely to search without filtering.',
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    failFilter(
      operation,
      scope,
      `filter${path} cannot be an empty object ({}) — AWS rejects this as an invalid filter. ` +
        'Omit the filter argument entirely to search without filtering.',
    );
  }
  if (keys.length > 1) {
    failFilter(
      operation,
      scope,
      `filter${path} holds ${keys.length} conditions (${keys.join(', ')}), but S3 Vectors ` +
        `takes exactly one per object. Combine them with $and: { $and: [{ ${keys[0]!}: … }, ` +
        `{ ${keys[1]!}: … }] }.`,
    );
  }

  const key = keys[0]!;
  if (LOGICAL_OPERATORS.has(key)) {
    assertLogicalBranch(value[key], key, path, operation, scope, depth);
    return;
  }
  if (OPERAND_RULES.has(key)) {
    failFilter(
      operation,
      scope,
      `filter${path} uses '${key}' where a field name belongs. A comparison operator ` +
        `applies to a field, as in { year: { ${key}: … } }; only ` +
        `${[...LOGICAL_OPERATORS].join(' and ')} may appear on their own.`,
    );
  }
  if (key.startsWith('$')) failFilter(operation, scope, unknownOperatorMessage(path, key));
  const nameReason = unpairedSurrogateReason(key);
  if (nameReason !== undefined) {
    failFilter(operation, scope, `filter${path} has a field name that ${nameReason}.`);
  }
  assertFieldCondition(value[key], `${path}.${key}`, operation, scope);
}

/**
 * Validate a metadata filter against every rule S3 Vectors applies to one.
 *
 * Accepts:
 * - `undefined` or `null` — no filter; accepted, and the search runs
 *   unfiltered. `null` is read as "not provided" because a config assembled at
 *   runtime defaults an absent field to it.
 * - a plain object holding exactly one condition, nested through `$and`/`$or`
 *   up to {@link MAX_FILTER_DEPTH} levels. Plain is tested by prototype shape, so an object from another
 *   realm (a `vm` context, a worker `postMessage`, `structuredClone`) passes
 *   while a class instance, `Map` or `Date` does not.
 *
 * Returns: `undefined` for no filter; otherwise a copy of the accepted filter,
 * branded, which is what a request sends — so a caller changing their object
 * after this returns changes nothing that was checked.
 *
 * Throws: `VALIDATION`, naming the path and the rule, for:
 * - an array, a non-plain object, or `{}` where a condition belongs;
 * - a condition object with more than one key — combine them with `$and`
 *   (T3-17);
 * - a comparison operator where a field name belongs, or an unknown
 *   `$`-prefixed key;
 * - an `$and`/`$or` whose value is not a non-empty array of conditions;
 * - a field name that is not well-formed UTF-16
 *   (docs/evidence/string-encoding.md, T3-15);
 * - a field's operator object that is empty, or holds a key that is not a
 *   comparison operator, `$and`/`$or` included (T3-18);
 * - an operand its operator does not take (T3-16): `$eq`, `$ne` and the
 *   shorthand take a string, a finite number or a boolean; `$gt`, `$gte`, `$lt`
 *   and `$lte` a finite number; `$in` and `$nin` a non-empty array of those,
 *   types mixed freely; `$exists` a boolean. A string anywhere must be
 *   well-formed UTF-16.
 *
 * Guarantees: nothing is refused here that AWS would have accepted, with one
 * deliberate exception shared with `shared/metadata.ts`: a value the AWS SDK
 * would send as something other than what was written — a non-finite number,
 * sent as a string, or a `Date`, sent as a timestamp — is refused although the
 * service would accept what it becomes (T3-19), because the filter would then
 * silently match nothing, or compare against a number nobody chose. Every other
 * rule is documented (userguide `s3-vectors-metadata-filtering.html`) or
 * confirmed live (`docs/evidence/filter-validation.md`; the UTF-16 rule in
 * `docs/evidence/string-encoding.md`).
 *
 * And the local check is worth more here than almost anywhere else in this
 * package, because AWS's entire diagnosis is the string `"Invalid filter"`,
 * identical for every one of these. This one names the key, the path and the
 * rule.
 */
export function parseFilter(
  filter: unknown,
  operation: string,
  scope: StoreScope,
): ParsedFilter | undefined {
  if (filter === undefined || filter === null) return undefined;
  assertConditions(filter, '', operation, scope, 0);
  // The one place the brand is applied, which is what makes it mean anything:
  // every other module can only obtain a ParsedFilter by calling this.
  //
  // Applied to a copy. A search embeds its query between this check and the
  // request, and the caller's own object was what the request then sent: changed
  // in that gap — a filter object reused to build the next query — AWS received
  // conditions nothing here had seen, and answers every bad one with the same
  // two words.
  return copyOf(filter) as ParsedFilter;
}

/**
 * A filter's own copy: every object and array in it rebuilt, every leaf as is.
 *
 * Only ever given a filter {@link assertConditions} has accepted, which is what
 * makes this total: that check bounds the depth, and leaves nothing in it but
 * plain objects, arrays, strings, finite numbers and booleans.
 */
function copyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyOf);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).map((key) => [key, copyOf(value[key])]));
}
