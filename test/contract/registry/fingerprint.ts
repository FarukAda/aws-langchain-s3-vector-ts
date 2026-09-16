/** How deep a fingerprint looks. Nothing the corpus builds nests deeper. */
const MAX_DEPTH = 6;

/**
 * A string that changes whenever `value`, or anything reachable from it, does.
 *
 * Accepts: anything the corpus sends — every primitive type, arrays with holes,
 * functions, symbols, null-prototype objects and class instances.
 *
 * Returns: a structural rendering. Objects are tagged with their prototype's
 * constructor name (`null` for a null-prototype object), a `Date` with its time,
 * and keys are sorted, so two renderings of an unchanged value are identical.
 *
 * Throws: nothing.
 */
export function fingerprint(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return '…';
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return `s:${JSON.stringify(value)}`;
    case 'number':
      return `n:${String(value)}`;
    case 'bigint':
      return `b:${value.toString()}`;
    case 'boolean':
      return `t:${String(value)}`;
    case 'symbol':
      return `y:${value.toString()}`;
    case 'function':
      return 'f';
    default:
      break;
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      items.push(Object.hasOwn(value, index) ? fingerprint(value[index], depth + 1) : '<hole>');
    }
    return `[${items.join(',')}]`;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  const constructorName = (proto as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  const tag = proto === null ? 'null' : typeof constructorName === 'string' ? constructorName : '?';
  const time = tag === 'Date' ? `@${(value as Date).getTime()}` : '';
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${fingerprint(record[key], depth + 1)}`);
  return `${tag}${time}{${fields.join(',')}}`;
}
