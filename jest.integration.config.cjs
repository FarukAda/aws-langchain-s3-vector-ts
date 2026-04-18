/**
 * Integration test runner. These tests talk to a real AWS S3 Vectors
 * bucket. They are intentionally kept out of the default `npm test` run
 * and are off by default — see test/integration/_guard.ts for the env
 * gating contract.
 *
 * To run locally:
 *   export RUN_LIVE_INTEGRATION=1
 *   export AWS_VECTOR_BUCKET=<your-vector-bucket>
 *   export AWS_REGION=us-east-1
 *   npm run test:integration
 *
 * LocalStack does NOT support s3vectors (see
 * https://github.com/localstack/localstack/issues/13498), so these
 * tests require a real AWS account with a pre-created S3 vector bucket.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 120000,
  clearMocks: true,
  collectCoverage: false,
  maxWorkers: 1,
  verbose: true,
};
