import type { EmbeddingsInterface } from '@langchain/core/embeddings';

/** Symbol used to identify StubEmbeddings without instanceof. */
const STUB_BRAND = Symbol.for('@farukada/aws-langchain-s3-vector-ts:StubEmbeddings');

/**
 * The placeholder embedding model a raw-vector store holds.
 *
 * `@langchain/core`'s `VectorStore` constructor requires an
 * `EmbeddingsInterface`, but a store used only with `addVectors` and
 * `getByIds` legitimately has no model. This stands in so that case needs no
 * nullable field, and both its methods throw if anything ever calls them —
 * though nothing does: the store checks {@link isStubEmbeddings} first and
 * raises `EMBEDDINGS_MISSING`, naming the option to set.
 *
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

/**
 * Whether `emb` is the placeholder rather than a real embedding model.
 *
 * Accepts: anything, including a non-object.
 *
 * Returns: `true` only for a value carrying this package's registered-symbol
 * brand. Not `instanceof`, for the same reason as every other identity test
 * here: it is false across realms and between the ESM and CommonJS copies of
 * this module.
 *
 * Throws: nothing.
 */
export function isStubEmbeddings(emb: unknown): boolean {
  return (
    typeof emb === 'object' && emb !== null && (emb as Record<symbol, boolean>)[STUB_BRAND] === true
  );
}
