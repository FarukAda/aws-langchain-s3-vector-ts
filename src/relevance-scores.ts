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
 * Convert a **cosine distance** (range [0, 2]) to a relevance score [−1, 1].
 *
 * For normalised embeddings the distance is in [0, 2] so the score lands in
 * [−1, 1], but in practice most embedding models produce scores in [0, 1].
 */
export function cosineRelevanceScoreFn(distance: number): number {
  return 1.0 - distance;
}
