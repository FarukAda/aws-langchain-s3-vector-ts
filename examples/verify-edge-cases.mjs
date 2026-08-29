import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors, S3VectorsErrorCode } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectErrorCode, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const embeddings = createEmbeddings(region);

const noContentIndex = `verify-edge-nc-${randomUUID().slice(0, 8)}`;
const rawIndex = `verify-edge-raw-${randomUUID().slice(0, 8)}`;
const dupIndex = `verify-edge-dup-${randomUUID().slice(0, 8)}`;
const nonFilterableIndex = `verify-edge-nf-${randomUUID().slice(0, 8)}`;
const batchIndex = `verify-edge-batch-${randomUUID().slice(0, 8)}`;

const BATCH_DOC_COUNT = 501;

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
const nonFilterableStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: nonFilterableIndex,
  region,
  nonFilterableMetadataKeys: ['blob'],
});
const batchStore = new AmazonS3Vectors(embeddings, {
  vectorBucketName: bucketName,
  indexName: batchIndex,
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
  await expectErrorCode(
    'text query without embeddings throws EMBEDDINGS_MISSING',
    () => rawStore.similaritySearchWithScore('anything', 1),
    S3VectorsErrorCode.EMBEDDINGS_MISSING,
  );

  section('getByIds throws a typed NOT_FOUND for a missing id');
  await expectErrorCode(
    'missing id rejected with NOT_FOUND',
    () => rawStore.getByIds(['does-not-exist']),
    S3VectorsErrorCode.NOT_FOUND,
  );

  section('duplicate ids in getByIds return isolated metadata copies');
  await dupStore.addDocuments([new Document({ pageContent: 'dup', metadata: { tag: 'orig' } })], {
    ids: ['dup-1'],
  });
  const dupDocs = await dupStore.getByIds(['dup-1', 'dup-1']);
  dupDocs[0].metadata.tag = 'mutated';
  check('second copy unaffected by mutation', dupDocs[1].metadata.tag === 'orig');

  section('nonFilterableMetadataKeys: value is stored but not filterable');
  await nonFilterableStore.addDocuments(
    [new Document({ pageContent: 'config doc', metadata: { topic: 'cfg', blob: 'large-context' } })],
    { ids: ['nf-1'] },
  );
  const [nfDoc] = await nonFilterableStore.getByIds(['nf-1']);
  check('non-filterable value still round-trips', nfDoc.metadata.blob === 'large-context');
  const byFilterable = await nonFilterableStore.similaritySearch('config', 3, { topic: 'cfg' });
  check('filter on a filterable key works', byFilterable.some((d) => d.id === 'nf-1'));
  await expectErrorCode(
    'filtering on a non-filterable key is rejected (typed AWS error)',
    () => nonFilterableStore.similaritySearch('config', 3, { blob: 'large-context' }),
    S3VectorsErrorCode.AWS_REQUEST_FAILED,
  );

  section(`batch boundaries: ${BATCH_DOC_COUNT} vectors cross the 200 put / 100 get / 500 delete defaults`);
  const [probeVector] = await embeddings.embedDocuments(['batch boundary probe']);
  const batchVectors = Array.from({ length: BATCH_DOC_COUNT }, () => probeVector);
  const batchDocs = Array.from(
    { length: BATCH_DOC_COUNT },
    (_, i) => new Document({ pageContent: `batch item ${i}`, metadata: { n: i } }),
  );
  const batchIds = Array.from({ length: BATCH_DOC_COUNT }, (_, i) => `b-${i}`);
  const storedIds = await batchStore.addVectors(batchVectors, batchDocs, { ids: batchIds });
  check('all ids returned across put batches', storedIds.length === BATCH_DOC_COUNT);
  const fetched = await batchStore.getByIds(batchIds);
  check('all docs retrieved across get batches', fetched.length === BATCH_DOC_COUNT);
  check(
    'order preserved across get batches',
    fetched[0].id === 'b-0' && fetched[BATCH_DOC_COUNT - 1].id === `b-${BATCH_DOC_COUNT - 1}`,
  );
  await batchStore.delete({ ids: batchIds });
  await expectErrorCode(
    'delete across the 500 boundary removed every vector',
    () => batchStore.getByIds(['b-0']),
    S3VectorsErrorCode.NOT_FOUND,
  );
} finally {
  await noContentStore.delete({ deleteAll: true }).catch(() => {});
  await rawStore.delete({ deleteAll: true }).catch(() => {});
  await dupStore.delete({ deleteAll: true }).catch(() => {});
  await nonFilterableStore.delete({ deleteAll: true }).catch(() => {});
  await batchStore.delete({ deleteAll: true }).catch(() => {});
}

summary();