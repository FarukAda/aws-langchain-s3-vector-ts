/**
 * What an error raised anywhere in this package has to be able to name.
 *
 * These two types sit in `shared/` rather than beside the code that threads
 * them because `shared/` is where the error, metadata and validation modules
 * live, and those modules name the index and the operation in every message
 * they build. Declared any higher, each of them would have to reach up a layer
 * for a plain data type — which is how three upward imports got here before
 * `test/contract/layer-direction.test.ts` made the direction a gate.
 *
 * They carry no behaviour and no client, so nothing above can be dragged down
 * with them.
 */

/** The bucket and index an error should name. */
export interface StoreScope {
  /** The vector bucket the operation acts on. */
  readonly vectorBucketName: string;
  /** The index inside it. */
  readonly indexName: string;
}

/**
 * What any operation needs in order to name itself in an error.
 *
 * Every error this package raises carries `operation` plus the bucket and
 * index, so a failure says which call, against which index, without the caller
 * correlating a stack trace.
 */
export interface OperationScope extends StoreScope {
  /**
   * The public method this call belongs to — `'addDocuments'`,
   * `'similaritySearch'`, `'listVectors'`. It is the caller's name for the
   * operation, never an AWS command's, so an error names something the caller
   * actually wrote — on every error, one raised by a failed request included.
   * That request is named separately, as `awsCommand` (`'PutVectors'`), by the
   * site that issued it.
   */
  readonly operation: string;
}
