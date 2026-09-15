import { readFileSync } from 'node:fs';

import { describe, it, expect } from '@jest/globals';

import * as publicApi from '../../src/index.js';
import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { S3VectorsErrorCode } from '../../src/shared/errors/error-code.js';

/**
 * The documentation names only things that exist.
 *
 * This is the drift that actually happened: the README documented `addTexts`,
 * `similaritySearchByVector` and `euclideanRelevanceScoreFn` for a whole
 * release after they were gone, and claimed `createDocument` was exported when
 * it never was. Prose cannot be type-checked, but the *names* in it can be.
 */
const DOCS = ['README.md', 'src/guide.md'] as const;

const read = (doc: string): string =>
  readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8');

/** Names documented as methods on a store instance. */
function documentedMethods(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:store|retriever|cycle|copy|target)\.(\w+)\(/g)) {
    found.add(match[1]!);
  }
  // Table rows like `| `addVectors(vectors, docs, options?)` | …` document the
  // signature without a receiver.
  for (const match of text.matchAll(/^\| `(\w+)\(/gm)) {
    found.add(match[1]!);
  }
  return [...found];
}

const instanceApi = new Set<string>([
  ...Object.getOwnPropertyNames(AmazonS3Vectors.prototype),
  ...Object.getOwnPropertyNames(Object.getPrototypeOf(AmazonS3Vectors.prototype) as object),
  // Inherited from @langchain/core's VectorStore and Runnable, which the docs
  // legitimately reference.
  'asRetriever',
  'addDocuments',
  'invoke',
  'batch',
  'stream',
  'pipe',
]);

const staticApi = new Set<string>(Object.getOwnPropertyNames(AmazonS3Vectors));

describe.each(DOCS)('%s documents only names that exist', (doc) => {
  const text = read(doc);

  it('every method it shows on a store or retriever is real', () => {
    const unknown = documentedMethods(text).filter(
      (name) => !instanceApi.has(name) && !staticApi.has(name),
    );
    expect(unknown).toEqual([]);
  });

  it('every static factory it shows is real', () => {
    const shown = [...text.matchAll(/AmazonS3Vectors\.(\w+)\(/g)].map((m) => m[1]!);
    expect(shown.filter((name) => !staticApi.has(name))).toEqual([]);
  });

  it('every error code it names is a member of the enum', () => {
    // Only names presented *as* codes: the first cell of a table row, or an
    // explicit enum access. Prose mentions environment variables and AWS
    // exception names in the same shape, and those are not this enum.
    const named = [
      ...[...text.matchAll(/^\| `([A-Z][A-Z_]+)` \|/gm)].map((m) => m[1]!),
      ...[...text.matchAll(/S3VectorsErrorCode\.([A-Z][A-Z_]+)/g)].map((m) => m[1]!),
    ];
    const enumMembers = new Set<string>(Object.keys(S3VectorsErrorCode));
    expect(named.filter((name) => !enumMembers.has(name))).toEqual([]);
  });

  it('checks a real list of codes, so an empty scan cannot pass', () => {
    const named = [...text.matchAll(/^\| `([A-Z][A-Z_]+)` \|/gm)].map((m) => m[1]!);
    // README and the guide each carry the full error table, so nothing found
    // means the pattern broke rather than that the table is clean.
    expect(named.length).toBeGreaterThan(8);
  });

  it('every package export it names is exported', () => {
    const exported = new Set<string>(Object.keys(publicApi));
    // Type-only exports are invisible at runtime; list them explicitly so the
    // check still fails on a name that is neither.
    const typeExports = new Set([
      'AmazonS3VectorsConfig',
      'AmazonS3VectorsRetrieverFields',
      'AmazonS3VectorsRetrieverInput',
      'DistanceMetric',
      'VectorDataType',
      'S3VectorsDeleteParams',
      'S3VectorsDeleteIndexParams',
      'S3VectorsListParams',
      'S3VectorsRecord',
      'S3OutputVector',
      'S3VectorsErrorContext',
    ]);
    const imported = [
      ...text.matchAll(/import \{([^}]+)\} from ["']@farukada\/aws-langchain-s3-vector-ts["']/g),
    ]
      .flatMap((m) => m[1]!.split(','))
      .map((name) => name.replace(/\/\/.*$/, '').trim())
      .filter((name) => name.length > 0 && /^[A-Za-z]/.test(name));
    expect(imported.filter((name) => !exported.has(name) && !typeExports.has(name))).toEqual([]);
  });
});
