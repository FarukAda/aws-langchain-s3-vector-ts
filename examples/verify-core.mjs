import { randomUUID } from 'node:crypto';

import { Document } from '@langchain/core/documents';

import { AmazonS3Vectors } from '../dist/index.js';
import { createEmbeddings } from './_embeddings.mjs';
import { check, expectThrow, requireEnv, section, summary } from './_harness.mjs';

const { bucketName, region } = requireEnv();
const indexName = `verify-core-${randomUUID().slice(0, 8)}`;
const store = new AmazonS3Vectors(createEmbeddings(region), {
  vectorBucketName: bucketName,
  indexName,
  region,
});

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
  await expectThrow(
    'deleted id is no longer retrievable',
    () => store.getByIds(['core-3']),
    'not found',
  );
} finally {
  await store.delete().catch(() => {});
}

summary();