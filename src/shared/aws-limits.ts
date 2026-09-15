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
 * Enforced on `pageContentMetadataKey` at construction, and on every
 * non-filterable key at index creation — the same limit, since a non-filterable
 * key is a metadata key.
 */
export const METADATA_KEY_MIN_LENGTH = 1;
export const METADATA_KEY_MAX_LENGTH = 63;

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
