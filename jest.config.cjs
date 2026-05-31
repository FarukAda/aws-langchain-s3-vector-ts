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
  verbose: true,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 90000,
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
