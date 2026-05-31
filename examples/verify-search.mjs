import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const CORPUS = [
  new Document({ pageContent: 'cats and dogs are common pets', metadata: { topic: 'pets' } }),
  new Document({ pageContent: 'rockets travel to the moon and mars', metadata: { topic: 'space' } }),
  new Document({ pageContent: 'pasta and pizza are italian dishes', metadata: { topic: 'food' } }),
];

async function seed(distanceMetric) {
  const indexName = `verify-search-${distanceMetric}-${randomUUID().slice(0, 8)}`;
  const store = new AmazonS3Vectors(embeddings, {
    vectorBucketName: bucketName,
    indexName,
    region,
    distanceMetric,
  });
  await store.addDocuments(CORPUS, { ids: ['s-1', 's-2', 's-3'] });
  return store;
}

const cosine = await seed('cosine');
const euclidean = await seed('euclidean');

try {
  section('similaritySearch returns the most relevant document first');
  const top = await cosine.similaritySearch('space exploration', 1);
  check('semantically nearest doc returned', top[0].metadata.topic === 'space');

  section('similaritySearchWithScore returns [doc, distance] tuples');
  const scored = await cosine.similaritySearchWithScore('italian cuisine', 1);
  check('tuple shape', Array.isArray(scored[0]) && typeof scored[0][1] === 'number');
  check('food doc ranked first', scored[0][0].metadata.topic === 'food');

  section('similaritySearchByVector accepts a raw query vector');
  const qVec = await embeddings.embedQuery('household animals');
  const byVec = await cosine.similaritySearchByVector(qVec, 1);
  check('pets doc returned', byVec[0].metadata.topic === 'pets');

  section('metadata filter narrows the candidate set');
  const filtered = await cosine.similaritySearch('anything', 3, { topic: 'space' });
  check('only matching topic returned', filtered.every((d) => d.metadata.topic === 'space'));

  section('filter operators narrow results');
  const inResults = await cosine.similaritySearch('anything', 3, {
    topic: { $in: ['space', 'food'] },
  });
  check(
    '$in matches multiple topics',
    inResults.length > 0 && inResults.every((d) => ['space', 'food'].includes(d.metadata.topic)),
  );
  const andResults = await cosine.similaritySearch('anything', 3, {
    $and: [{ topic: { $eq: 'space' } }, { topic: { $ne: 'food' } }],
  });
  check('$and/$ne compose', andResults.every((d) => d.metadata.topic === 'space'));

  section('asRetriever returns documents for a query');
  const retriever = cosine.asRetriever(2);
  const retrieved = await retriever.invoke('space exploration');
  check('retriever returns up to k docs', retrieved.length > 0 && retrieved.length <= 2);

  section('relevance-score function follows the distance metric');
  check('cosine selects cosine scorer', cosine._selectRelevanceScoreFn()(0) === 1);
  check('euclidean selects euclidean scorer', euclidean._selectRelevanceScoreFn()(0) === 1);
} finally {
  await cosine.delete().catch(() => {});
  await euclidean.delete().catch(() => {});
}

summary();