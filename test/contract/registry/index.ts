import { addDocumentsContract } from './entries/add-documents.js';
import { addVectorsContract } from './entries/add-vectors.js';
import { deleteContract } from './entries/delete.js';
import { getByIdsContract } from './entries/get-by-ids.js';
import { mmrContract } from './entries/mmr.js';
import {
  similaritySearchContract,
  similaritySearchVectorContract,
  similaritySearchWithScoreContract,
} from './entries/search.js';
import type { EntryPointContract } from './types.js';

/**
 * Every public entry point that must eventually carry an executable contract.
 *
 * Listed explicitly rather than derived from the prototype, because the
 * prototype is not the contract: TypeScript's `private` is erased, so
 * `_putBatch` and `_textSearch` are runtime-visible without being public API.
 * This is the intended surface; the runtime is checked against it.
 */
export const PUBLIC_ENTRY_POINTS: readonly string[] = [
  'AmazonS3Vectors.addVectors',
  'AmazonS3Vectors.addDocuments',
  'AmazonS3Vectors.similaritySearch',
  'AmazonS3Vectors.similaritySearchWithScore',
  'AmazonS3Vectors.similaritySearchVectorWithScore',
  'AmazonS3Vectors.similaritySearchWithRelevanceScores',
  'AmazonS3Vectors.maxMarginalRelevanceSearch',
  'AmazonS3Vectors.delete',
  'AmazonS3Vectors.deleteIndex',
  'AmazonS3Vectors.getByIds',
  'AmazonS3Vectors.listDocuments',
  'AmazonS3Vectors.listVectors',
  'AmazonS3Vectors.asRetriever',
  'AmazonS3Vectors._vectorstoreType',
  'AmazonS3Vectors.fromTexts',
  'AmazonS3Vectors.fromDocuments',
];

/**
 * Entry points still awaiting a contract, removed one at a time as the
 * remediation phases register them.
 *
 * Same discipline as the known-gap ledger: a new public method that is not
 * registered and not listed here fails the suite, and listing one that *is*
 * registered fails too. The list only shrinks.
 *
 * **What is left, and why each is still here.** The read path is no longer
 * among them: `similaritySearch`, `similaritySearchWithScore` and
 * `similaritySearchVectorWithScore` are registered, which matters because they
 * are what a LangChain consumer actually reaches — core's own
 * `VectorStoreRetriever` dispatches to the first, and the third is the one
 * *abstract* member of core's `VectorStore`. Until they were, none of the six
 * properties and none of the hostile corpus had ever swept a query, while the
 * suite reported that the registry covered the public surface.
 *
 * - `similaritySearchWithRelevanceScores` — the same domain as its registered
 *   siblings, differing only in the conversion applied to the result. Covered
 *   by example in `relevance-selection.test.ts`.
 * - `asRetriever` and `_vectorstoreType` — neither performs I/O, so the
 *   properties about spending, concurrency and error context have nothing to
 *   say about them. A contract for `asRetriever` would be about its field
 *   validation, which is a different shape from the rest of this registry.
 * - `fromTexts` and `fromDocuments` — static factories that construct a store
 *   *and* write with it, so a case cannot be run against a prepared store the
 *   way every entry here is. Covered by example in `from-texts.test.ts`.
 * - `deleteIndex`, `listDocuments`, `listVectors` — not members of core's
 *   `VectorStore`, so no LangChain consumer reaches them through the
 *   framework. `listDocuments`/`listVectors` are generators, whose failures
 *   arrive on `next()` rather than from the call, which the harness does not
 *   model.
 */
export const PENDING_ENTRY_POINTS: readonly string[] = [
  'AmazonS3Vectors.similaritySearchWithRelevanceScores',
  'AmazonS3Vectors.deleteIndex',
  'AmazonS3Vectors.listDocuments',
  'AmazonS3Vectors.listVectors',
  'AmazonS3Vectors.asRetriever',
  'AmazonS3Vectors._vectorstoreType',
  'AmazonS3Vectors.fromTexts',
  'AmazonS3Vectors.fromDocuments',
];

/**
 * The contracts the conformance suite runs.
 *
 * Typed over `unknown` because that is what a contract must accept: the corpus
 * exists to send values the declared parameter type forbids, so a registry
 * typed to the public signature could not express half of its own cases.
 */
export const REGISTRY: readonly EntryPointContract<unknown>[] = [
  deleteContract,
  addVectorsContract as EntryPointContract<unknown>,
  addDocumentsContract as EntryPointContract<unknown>,
  getByIdsContract as EntryPointContract<unknown>,
  mmrContract as EntryPointContract<unknown>,
  similaritySearchContract as EntryPointContract<unknown>,
  similaritySearchWithScoreContract as EntryPointContract<unknown>,
  similaritySearchVectorContract as EntryPointContract<unknown>,
];
