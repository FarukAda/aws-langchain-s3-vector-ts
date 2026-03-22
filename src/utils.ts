/**
 * Relevance-score conversion utilities for Amazon S3 Vectors distance metrics.
 *
 * S3 Vectors returns a raw *distance* value for each query result.
 * LangChain expects a *relevance score* — higher is better — normalised
 * to roughly [0, 1].  These functions bridge the two conventions.
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
 * Convert a **euclidean distance** to a relevance score [0, 1].
 *
 * The upper bound uses the maximum dimension supported by S3 Vectors (4 096).
 * This is the same heuristic used by the Python `langchain-aws` library.
 */
export function euclideanRelevanceScoreFn(distance: number): number {
  const MAX_DIMENSION = 4096;
  return 1.0 - distance / Math.sqrt(MAX_DIMENSION);
}
