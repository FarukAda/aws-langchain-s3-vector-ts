import { isS3VectorsError } from '../dist/index.js';

let passed = 0;
let failed = 0;

const DEFAULT_REGION = 'us-east-1';

export function section(name) {
  console.log(`\n── ${name} ──`);
}

export function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) passed += 1;
  else failed += 1;
}

/**
 * Assert that `fn` rejects with an S3VectorsError carrying exactly `code`.
 *
 * Asserts on the error's `code`, never on its `name` or message text. Every
 * error this library raises has `name === 'S3VectorsError'`, so a
 * `name === code` comparison could never match and silently degraded to a
 * substring match on the message — which passes whenever the message merely
 * happens to contain the string, including for a completely unrelated
 * failure.
 */
export async function expectErrorCode(label, fn, code) {
  try {
    await fn();
    check(label, false);
  } catch (error) {
    const actual = isS3VectorsError(error) ? error.code : `<uncoded ${error?.name ?? typeof error}>`;
    if (actual !== code) {
      console.log(`        expected code ${code}, got ${actual}`);
    }
    check(label, actual === code);
  }
}

export function summary() {
  console.log(`\n==== ${passed} passed, ${failed} failed ====`);
  if (failed > 0) process.exitCode = 1;
}

export function requireEnv() {
  const bucketName = process.env.AWS_VECTOR_BUCKET;
  const region = process.env.AWS_REGION ?? DEFAULT_REGION;
  if (!bucketName) {
    console.error('Set AWS_VECTOR_BUCKET (and optionally AWS_REGION) to run verification.');
    process.exit(1);
  }
  return { bucketName, region };
}