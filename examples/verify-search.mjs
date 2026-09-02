import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/esm/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const CORPUS = [
  new Document({ pageContent: 'cats and dogs are common pets', metadata: { topic: 'pets', year: 2001 } }),
  new Document({
    pageContent: 'rockets travel to the moon and mars',
    metadata: { topic: 'space', year: 2010 },
  }),
  new Document({
    pageContent: 'pasta and pizza are italian dishes',
    metadata: { topic: 'food', year: 2020 },
  }),
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
  const topics = async (filter) =>
    (await cosine.similaritySearch('anything', 3, filter)).map((d) => d.metadata.topic).sort();

  check('$eq matches one topic', (await topics({ topic: { $eq: 'space' } })).join() === 'space');
  check(
    '$ne excludes one topic',
    (await topics({ topic: { $ne: 'food' } })).join() === 'pets,space',
  );
  check(
    '$in matches multiple topics',
    (await topics({ topic: { $in: ['space', 'food'] } })).join() === 'food,space',
  );
  check('$nin excludes listed topics', (await topics({ topic: { $nin: ['food'] } })).length === 2);
  check('$gt on a number', (await topics({ year: { $gt: 2005 } })).join() === 'food,space');
  check('$gte on a number', (await topics({ year: { $gte: 2010 } })).join() === 'food,space');
  check('$lt on a number', (await topics({ year: { $lt: 2015 } })).join() === 'pets,space');
  check('$lte on a number', (await topics({ year: { $lte: 2001 } })).join() === 'pets');
  check('$exists matches all', (await topics({ year: { $exists: true } })).length === 3);
  check(
    '$and composes conditions',
    (await topics({ $and: [{ topic: { $eq: 'space' } }, { year: { $gte: 2010 } }] })).join() ===
      'space',
  );
  check(
    '$or composes conditions',
    (await topics({ $or: [{ topic: { $eq: 'pets' } }, { topic: { $eq: 'food' } }] })).join() ===
      'food,pets',
  );

  section('asRetriever returns documents for a query');
  const retriever = cosine.asRetriever(2);
  const retrieved = await retriever.invoke('space exploration');
  check('retriever returns up to k docs', retrieved.length > 0 && retrieved.length <= 2);

  section('relevance-score function follows the distance metric');
  check('cosine selects cosine scorer', cosine._selectRelevanceScoreFn()(0) === 1);
  check('euclidean selects euclidean scorer', euclidean._selectRelevanceScoreFn()(0) === 1);
} finally {
  await cosine.delete({ deleteAll: true }).catch(() => {});
  await euclidean.delete({ deleteAll: true }).catch(() => {});
}

summary();