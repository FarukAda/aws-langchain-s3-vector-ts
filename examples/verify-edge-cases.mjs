import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectThrow, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const noContentIndex = `verify-edge-nc-${randomUUID().slice(0, 8)}`;
const rawIndex = `verify-edge-raw-${randomUUID().slice(0, 8)}`;
const dupIndex = `verify-edge-dup-${randomUUID().slice(0, 8)}`;

const noContentStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: noContentIndex,
  region,
  pageContentMetadataKey: null,
});
const rawStore = new AmazonS3Vectors(undefined, {
  vectorBucketName: bucketName,
  indexName: rawIndex,
  region,
});
const dupStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: dupIndex,
  region,
});

try {
  section('pageContentMetadataKey: null embeds but does not store content');
  await noContentStore.addDocuments(
    [new Document({ pageContent: 'secret body', metadata: { a: 1 } })],
    { ids: ['nc-1'] },
  );
  const [ncDoc] = await noContentStore.getByIds(['nc-1']);
  check('pageContent not persisted', ncDoc.pageContent === '');
  check('user metadata preserved', ncDoc.metadata.a === 1);

  section('raw-vector store works without an embedding model');
  const sample = await embeddings.embedDocuments(['raw vector sample']);
  await rawStore.addVectors(sample, [new Document({ pageContent: 'raw' })], { ids: ['raw-1'] });
  const [rawDoc] = await rawStore.getByIds(['raw-1']);
  check('vector stored and retrieved', rawDoc.id === 'raw-1');
  await expectThrow(
    'text query without embeddings throws',
    () => rawStore.similaritySearchWithScore('anything', 1),
    'No embedding model',
  );

  section('getByIds throws for a missing id');
  await expectThrow('missing id rejected', () => rawStore.getByIds(['does-not-exist']), 'not found');

  section('duplicate ids in getByIds return isolated metadata copies');
  await dupStore.addDocuments([new Document({ pageContent: 'dup', metadata: { tag: 'orig' } })], {
    ids: ['dup-1'],
  });
  const dupDocs = await dupStore.getByIds(['dup-1', 'dup-1']);
  dupDocs[0].metadata.tag = 'mutated';
  check('second copy unaffected by mutation', dupDocs[1].metadata.tag === 'orig');
} finally {
  await noContentStore.delete().catch(() => {});
  await rawStore.delete().catch(() => {});
  await dupStore.delete().catch(() => {});
}

summary();