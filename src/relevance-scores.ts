/**
 * Relevance-score conversion utilities for Amazon S3 Vectors distance metrics.
 *
 * S3 Vectors returns a raw *distance* value for each query result.
 * LangChain expects a *relevance score* — higher is better. These
 * functions convert distance to score using the same heuristics as the
 * Python `langchain-aws` reference implementation; provide a custom
 * `relevanceScoreFn` in the store config if you need different bounds
 * for your embedding model.
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

/**
 * Convert a **euclidean distance** to a relevance score, using the same
 * heuristic as the Python `langchain-aws` reference implementation.
 *
 * @remarks
 * Despite the metric's name, S3 Vectors' `euclidean` distance is
 * **squared** L2, not linear L2 (confirmed against the live service: a
 * point at true L2 distance 3 from the query returns a raw distance of
 * 9, not 3). This formula divides that squared value by a linear scale
 * (`sqrt(maxDimension)`), so — unlike the cosine conversion — the result
 * is **not** reliably bounded to [0, 1]: for unit-normalised embeddings
 * (the common case) scores land in a narrow band close to 1 rather than
 * spanning the full range, and for unnormalised or high-magnitude
 * embeddings the score can go negative. Provide a custom
 * `relevanceScoreFn` if you need threshold-able euclidean scores.
 */
export function euclideanRelevanceScoreFn(distance: number): number {
  const MAX_DIMENSION = 4096;
  return 1.0 - distance / Math.sqrt(MAX_DIMENSION);
}
