/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
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
  // Fails the run on an unhandled rejection or a listener-leak warning, which
  // Jest otherwise only prints. See the file for why this package needs it.
  setupFilesAfterEnv: ['<rootDir>/test/setup-strict-async.ts'],
  verbose: true,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // Unit tests run against aws-sdk-client-mock; none should take more than a
  // few hundred ms. A short ceiling turns a hang (a promise that never
  // settles) into a fast, attributable failure instead of a 90 s stall.
  // The live-integration config keeps its own, longer, timeout.
  testTimeout: 10000,
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  reporters: [
    'default',
    [
      'jest-sonar',
      {
        outputDirectory: 'coverage',
        outputName: 'test-report.xml',
        reportedFilePath: 'relative',
      },
    ],
  ],
};
