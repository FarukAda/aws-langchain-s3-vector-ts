/**
 * Env-gated guard for live-AWS integration tests.
 *
 * Integration tests MUST import and invoke this at the top of their
 * test file. If the guard returns `null`, the test file MUST skip
 * its suite (Jest will report zero tests in the file, which is the
 * intended behavior — no false pass, no false fail).
 */
interface LiveIntegrationEnv {
  readonly bucketName: string;
  readonly region: string;
}

export function requireLiveIntegrationEnv(): LiveIntegrationEnv | null {
  if (process.env['RUN_LIVE_INTEGRATION'] !== '1') {
    console.log(
      '[integration] Skipped: set RUN_LIVE_INTEGRATION=1 to run live-AWS integration tests.',
    );
    return null;
  }

  const bucketName = process.env['AWS_VECTOR_BUCKET'];
  if (!bucketName) {
    console.log(
      '[integration] Skipped: set AWS_VECTOR_BUCKET=<bucket> alongside RUN_LIVE_INTEGRATION=1.',
    );
    return null;
  }

  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  return { bucketName, region };
}
