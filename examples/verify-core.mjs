import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors, S3VectorsErrorCode } from '../dist/esm/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectErrorCode, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const indexName = `verify-core-${randomUUID().slice(0, 8)}`;
const store = new AmazonS3Vectors(createEmbeddings(region), {
  vectorBucketName: bucketName,
  indexName,
  region,
});

let fromDocsStore;
let fromTextsStore;
let queryEmbStore;

try {
  section('addDocuments auto-creates the index on first write');
  const ids = await store.addDocuments(
    [
      new Document({ pageContent: 'the quick brown fox', metadata: { kind: 'animal' } }),
      new Document({ pageContent: 'a distant spiral galaxy', metadata: { kind: 'space' } }),
    ],
    { ids: ['core-1', 'core-2'] },
  );
  check('returns the provided ids', ids.join(',') === 'core-1,core-2');

  section('getByIds preserves input order and round-trips data');
  const docs = await store.getByIds(['core-2', 'core-1']);
  check('order preserved', docs[0].id === 'core-2' && docs[1].id === 'core-1');
  check('metadata round-trips', docs[1].metadata.kind === 'animal');
  check('pageContent round-trips', docs[1].pageContent === 'the quick brown fox');

  section('addTexts wraps texts into documents');
  const textIds = await store.addTexts(['warm friendly hello'], [{ kind: 'greeting' }], {
    ids: ['core-3'],
  });
  check('returns the provided id', textIds[0] === 'core-3');

  section('addVectors stores a precomputed vector');
  const [probe] = await createEmbeddings(region).embedDocuments(['precomputed sample']);
  const vecIds = await store.addVectors([probe], [new Document({ pageContent: 'precomputed' })], {
    ids: ['core-4'],
  });
  check('returns the provided id', vecIds[0] === 'core-4');

  section('delete by id removes a single vector');
  await store.delete({ ids: ['core-3'] });
  await expectErrorCode(
    'deleted id is no longer retrievable',
    () => store.getByIds(['core-3']),
    S3VectorsErrorCode.NOT_FOUND,
  );

  section('fromDocuments factory creates and populates a store');
  fromDocsStore = await AmazonS3Vectors.fromDocuments(
    [new Document({ pageContent: 'factory document', metadata: { k: 'fd' } })],
    createEmbeddings(region),
    {
      vectorBucketName: bucketName,
      indexName: `verify-core-fd-${randomUUID().slice(0, 8)}`,
      region,
      ids: ['fd-1'],
    },
  );
  const fdDocs = await fromDocsStore.getByIds(['fd-1']);
  check('fromDocuments stored the document', fdDocs[0].metadata.k === 'fd');

  section('fromTexts factory creates and populates a store');
  fromTextsStore = await AmazonS3Vectors.fromTexts(
    ['factory text'],
    { k: 'ft' },
    createEmbeddings(region),
    {
      vectorBucketName: bucketName,
      indexName: `verify-core-ft-${randomUUID().slice(0, 8)}`,
      region,
      ids: ['ft-1'],
    },
  );
  const ftDocs = await fromTextsStore.getByIds(['ft-1']);
  check('fromTexts stored the text', ftDocs[0].metadata.k === 'ft');

  section('queryEmbeddings + retry config work end-to-end');
  queryEmbStore = new AmazonS3Vectors(createEmbeddings(region), {
    vectorBucketName: bucketName,
    indexName: `verify-core-qe-${randomUUID().slice(0, 8)}`,
    region,
    queryEmbeddings: createEmbeddings(region),
    maxAttempts: 5,
    retryMode: 'adaptive',
  });
  await queryEmbStore.addTexts(['searchable content here'], [{ k: 'qe' }], { ids: ['qe-1'] });
  const qeResults = await queryEmbStore.similaritySearchWithScore('searchable', 1);
  check('query via a separate queryEmbeddings model returns results', qeResults.length === 1);
} finally {
  await store.delete({ deleteAll: true }).catch(() => {});
  await fromDocsStore?.delete({ deleteAll: true }).catch(() => {});
  await fromTextsStore?.delete({ deleteAll: true }).catch(() => {});
  await queryEmbStore?.delete({ deleteAll: true }).catch(() => {});
}

summary();