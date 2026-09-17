import { PutVectorsCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { describe, it, expect } from '@jest/globals';

/**
 * `internal/request-size.ts` bounds a write by counting the bytes the request
 * body *will* carry, computed as `JSON.stringify` of the command input. That is
 * only sound while the SDK serialises a `PutVectors` body exactly that way:
 * same members, same order, no compression, no float reformatting. Measured
 * against the live service once (`docs/evidence/request-payload-limit.md`), and
 * guarded here on every run, because an SDK release could change it silently
 * and the failure would be a write refused by AWS for exceeding 20 MiB.
 */
const SCOPE = { vectorBucketName: 'bucket-a', indexName: 'index-a' } as const;

/** Send one command through a real client and return the body it put on the wire. */
async function wireBody(vectors: unknown[]): Promise<string> {
  let body: unknown;
  const client = new S3VectorsClient({
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
    requestHandler: {
      handle: (request: { body?: unknown }) => {
        body = request.body;
        // Nothing to respond with: the body is the whole point, so the call is
        // ended here rather than faking a deserialisable response.
        return Promise.reject(new Error('probe: body captured'));
      },
    },
  });
  await expect(
    client.send(new PutVectorsCommand({ ...SCOPE, vectors: vectors as never })),
  ).rejects.toThrow('probe: body captured');
  client.destroy();
  return typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('utf8');
}

describe('the PutVectors body the SDK sends', () => {
  it('is byte-identical to JSON.stringify of the command input', async () => {
    const vectors = [
      {
        key: 'k1',
        data: { float32: Array.from(new Float32Array([0.1, -0.25, 0.3333, 1e-7])) },
        metadata: { _page_content: 'héllo "quoted"', n: 1, flag: true, tags: ['a', 'b'] },
      },
      {
        key: 'k2 with \\ escapes 🙂',
        data: { float32: Array.from(new Float32Array([1, 2, 3, 4])) },
        metadata: { _page_content: '' },
      },
    ];
    const expected = JSON.stringify({ vectors, ...SCOPE });

    const actual = await wireBody(vectors);

    expect(actual).toBe(expected);
    expect(Buffer.byteLength(actual, 'utf8')).toBe(Buffer.byteLength(expected, 'utf8'));
  });
});
