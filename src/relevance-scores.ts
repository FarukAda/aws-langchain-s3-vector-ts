/**
 * Relevance-score conversion utilities for Amazon S3 Vectors distance metrics.
 *
 * S3 Vectors returns a raw *distance* value for each query result.
 * LangChain expects a *relevance score* — higher is better. These
 * functions convert distance to score from the documented distance range of
 * the metric; provide a custom `relevanceScoreFn` in the store config if you
 * need different bounds for your embedding model.
 */

/**
 * Convert a cosine distance to a LangChain relevance score.
 *
 * Accepts: a distance as S3 Vectors returns it for a cosine index. That value
 * is exactly `1 − cosine_similarity`, measured against the live service
 * (`docs/evidence/cosine-distance.md`), so its range is [0, 2].
 *
 * Returns: `1 − distance`, the exact inverse — so the range is [−1, 1], and
 * [0, 1] for the normalised embeddings most models produce. A caller
 * thresholding at 0 is asking for "no worse than orthogonal".
 *
 * Throws: nothing. A non-numeric distance cannot reach here: the search path
 * rejects a result without a finite numeric distance before scoring it.
 */
export function cosineRelevanceScoreFn(distance: number): number {
  return 1.0 - distance;
}
