/**
 * The AWS limits this package enforces from more than one place.
 *
 * Each of these was defined twice, and in three cases under two different
 * names — `MAX_TOP_K` in both `guards.ts` and `mmr.ts`, the dimension bounds in
 * both `limits.ts` and `index-lifecycle.ts`, the metadata-key length as
 * `METADATA_KEY_MAX_LENGTH` in one file and `NON_FILTERABLE_KEY_MAX` in
 * another, the tag bounds twice over.
 *
 * Every copy happened to agree, which is what made the arrangement dangerous
 * rather than merely untidy: nothing would have failed if one had been updated
 * and the others left behind, and no duplication detector could see it — single
 * lines, far apart, under names that do not match. `jscpd` reports zero clones
 * on this package and always did.
 *
 * A limit enforced in one place only stays with the code that enforces it.
 * These are here because they are enforced in two.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html
 */

/**
 * "Top-K results per QueryVectors request: Up to 10,000" (limits page).
 *
 * Enforced for `k` on every search, and for `k` and `fetchK` on MMR.
 */
export const MAX_TOP_K = 10_000;

/**
 * Vector dimension bounds (limits page).
 *
 * Enforced on the write path against the batch's own vectors, and again at
 * index creation against the dimension the index is created with.
 */
export const MIN_DIMENSION = 1;
export const MAX_DIMENSION = 4096;

/**
 * A metadata key is 1–63 characters (userguide `s3-vectors-indexes.html`).
 *
 * Enforced on `pageContentMetadataKey`, and on every non-filterable key
 * (merged with it, the same set {@link MAX_NON_FILTERABLE_KEYS} counts), both
 * at construction — the same limit, since a non-filterable key is a metadata
 * key — and again at index creation, as defence.
 */
export const METADATA_KEY_MIN_LENGTH = 1;
export const METADATA_KEY_MAX_LENGTH = 63;

/**
 * At most 10 non-filterable metadata keys on an index (limits page).
 *
 * Enforced on `nonFilterableMetadataKeys` merged with `pageContentMetadataKey`
 * — the set a created index would be given — at construction, and again at
 * index creation, which is where the error can name the index being created.
 * A list past this cap can never be written to any index, so construction
 * refuses it before an existing store's first read or write, not only before
 * one that would create the index.
 */
export const MAX_NON_FILTERABLE_KEYS = 10;

/**
 * Tag bounds.
 *
 * Enforced on `tags` at construction and again at index creation, which is
 * where the error can name the index being created.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html
 */
export const TAG_KEY_MIN_LENGTH = 1;
export const TAG_KEY_MAX_LENGTH = 128;
export const TAG_VALUE_MIN_LENGTH = 0;
export const TAG_VALUE_MAX_LENGTH = 256;

/**
 * Whether a tag key is a length `CreateIndex` accepts.
 *
 * Accepts: a tag key, already known to be a string.
 *
 * Returns: `true` for 1–128 characters.
 *
 * Throws: nothing.
 *
 * Guarantees: this is the rule, stated once. The numbers above were once
 * defined twice; the comparison built from them still was — once where
 * `config.tags` is checked at construction, once where an index is created —
 * each under its own wording. The two sites keep their wording, because each
 * names a different thing to fix, and share this.
 */
export function isTagKeyLength(key: string): boolean {
  return key.length >= TAG_KEY_MIN_LENGTH && key.length <= TAG_KEY_MAX_LENGTH;
}

/**
 * Whether a tag value is a length `CreateIndex` accepts.
 *
 * Accepts: a tag value, already known to be a string.
 *
 * Returns: `true` for 0–256 characters; an empty value is a valid tag.
 *
 * Throws: nothing.
 *
 * Guarantees: stated once, for the reason {@link isTagKeyLength} gives.
 */
export function isTagValueLength(value: string): boolean {
  return value.length >= TAG_VALUE_MIN_LENGTH && value.length <= TAG_VALUE_MAX_LENGTH;
}
