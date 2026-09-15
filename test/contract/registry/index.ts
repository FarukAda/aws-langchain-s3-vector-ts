import { deleteContract } from './entries/delete.js';
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
 */
export const PENDING_ENTRY_POINTS: readonly string[] = [
  'AmazonS3Vectors.addVectors',
  'AmazonS3Vectors.addDocuments',
  'AmazonS3Vectors.similaritySearch',
  'AmazonS3Vectors.similaritySearchWithScore',
  'AmazonS3Vectors.similaritySearchVectorWithScore',
  'AmazonS3Vectors.similaritySearchWithRelevanceScores',
  'AmazonS3Vectors.maxMarginalRelevanceSearch',
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
 * The contracts the conformance suite runs.
 *
 * Typed over `unknown` because that is what a contract must accept: the corpus
 * exists to send values the declared parameter type forbids, so a registry
 * typed to the public signature could not express half of its own cases.
 */
export const REGISTRY: readonly EntryPointContract<unknown>[] = [deleteContract];
