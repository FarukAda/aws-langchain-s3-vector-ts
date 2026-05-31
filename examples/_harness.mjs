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

export async function expectThrow(label, fn, code) {
  try {
    await fn();
    check(label, false);
  } catch (error) {
    const name = error?.name ?? '';
    const message = error?.message ?? '';
    check(label, name === code || message.includes(code));
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