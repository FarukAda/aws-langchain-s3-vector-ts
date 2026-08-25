import { GetIndexCommand, PutVectorsCommand, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

import { AmazonS3Vectors } from '../../src/s3-vectors.js';
import { BASE_CONFIG, createMockClient, createMockEmbeddings } from '../helpers.js';

function seededStore() {
  const { client, mock } = createMockClient();
  mock.on(GetIndexCommand).resolves({ index: {} });
  mock.on(PutVectorsCommand).resolves({});
  mock.on(QueryVectorsCommand).resolves({
    vectors: [
      { key: 'id-1', metadata: { _page_content: 'first', topic: 'a' }, distance: 0.1 },
      { key: 'id-2', metadata: { _page_content: 'second', topic: 'b' }, distance: 0.4 },
    ],
  });
  return new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
}

describe('VectorStore contract', () => {
  it('reports a stable vectorstore type', () => {
    expect(seededStore()._vectorstoreType()).toBe('amazonS3Vectors');
  });

  it('similaritySearch returns documents in result order', async () => {
    const docs = await seededStore().similaritySearch('q', 2);
    expect(docs.map((d) => d.id)).toEqual(['id-1', 'id-2']);
  });

  it('similaritySearchWithScore returns ascending distances', async () => {
    const scored = await seededStore().similaritySearchWithScore('q', 2);
    expect(scored[0]![1]).toBeLessThanOrEqual(scored[1]![1]);
  });

  it('asRetriever().invoke returns documents', async () => {
    const retriever = seededStore().asRetriever(2);
    const docs = await retriever.invoke('q');
    expect(docs).toHaveLength(2);
    expect(docs[0]!.id).toBe('id-1');
  });

  it('handles an empty result set', async () => {
    const { client, mock } = createMockClient();
    mock.on(QueryVectorsCommand).resolves({ vectors: [] });
    const store = new AmazonS3Vectors(createMockEmbeddings(), { ...BASE_CONFIG, client });
    expect(await store.similaritySearch('q', 5)).toEqual([]);
  });
});
