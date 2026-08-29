/**
 * Env-gated guard for live-AWS integration tests.
 *
 * Integration tests MUST import and invoke this at the top of their
 * test file. If the guard returns `null`, the test file MUST skip
 * its suite (Jest will report zero tests in the file, which is the
 * intended behavior — no false pass, no false fail).
 *
 * @remarks
 * Skipping is only ever the answer to "nobody asked for live tests." Once
 * `RUN_LIVE_INTEGRATION=1` says otherwise, a missing `AWS_VECTOR_BUCKET` is
 * a misconfiguration rather than an opt-out, and this throws instead of
 * skipping. That distinction is what stops a CI job from reporting success
 * having run nothing against AWS: a skipped suite exits 0, so a dropped env
 * line or an unset secret would otherwise turn the nightly live run green
 * while testing nothing at all.
 */
interface LiveIntegrationEnv {
  readonly bucketName: string;
  readonly region: string;
}

export function requireLiveIntegrationEnv(): LiveIntegrationEnv | null {
  const requested = process.env['RUN_LIVE_INTEGRATION'] === '1';

  if (!requested) {
    console.log(
      '[integration] Skipped: set RUN_LIVE_INTEGRATION=1 to run live-AWS integration tests.',
    );
    return null;
  }

  const bucketName = process.env['AWS_VECTOR_BUCKET'];
  if (!bucketName) {
    // Deliberately fatal, not a skip. See the remarks above.
    throw new Error(
      '[integration] RUN_LIVE_INTEGRATION=1 was set but AWS_VECTOR_BUCKET is missing. ' +
        'Refusing to skip silently: a skipped suite exits 0 and would report success without ' +
        'having run a single live-AWS test. Set AWS_VECTOR_BUCKET, or unset ' +
        'RUN_LIVE_INTEGRATION to opt out deliberately.',
    );
  }

  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  return { bucketName, region };
}
