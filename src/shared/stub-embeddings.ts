import type { EmbeddingsInterface } from '@langchain/core/embeddings';

/** Symbol used to identify StubEmbeddings without instanceof. */
const STUB_BRAND = Symbol('StubEmbeddings');

/**
 * Minimal no-op embeddings used as a placeholder when the caller does not
 * provide an embedding model (e.g. raw-vector-only workflows).
 * @internal
 */
export class StubEmbeddings implements EmbeddingsInterface {
  readonly [STUB_BRAND] = true;

  async embedDocuments(_documents: string[]): Promise<number[][]> {
    throw new Error('No embedding model configured');
  }
  async embedQuery(_query: string): Promise<number[]> {
    throw new Error('No embedding model configured');
  }
}

/** Type guard for StubEmbeddings that avoids instanceof. */
export function isStubEmbeddings(emb: unknown): boolean {
  return (
    typeof emb === 'object' && emb !== null && (emb as Record<symbol, boolean>)[STUB_BRAND] === true
  );
}
