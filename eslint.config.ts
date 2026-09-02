import eslint from '@eslint/js';
// @ts-expect-error — no types shipped
import noInstanceof from 'eslint-plugin-no-instanceof';
// @ts-expect-error — no types shipped
import perfectionist from 'eslint-plugin-perfectionist';
import prettier from 'eslint-plugin-prettier';
// @ts-expect-error — no types shipped
import unusedImports from 'eslint-plugin-unused-imports';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json is a superset of tsconfig.json (src + test), so
        // one program covers both and the test suite gets the same
        // type-aware rules as src — no-floating-promises in particular,
        // which is what catches an un-awaited `expect(...).rejects`.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier,
      perfectionist,
      'no-instanceof': noInstanceof,
      'unused-imports': unusedImports,
    },
    rules: {
      // Prettier integration — format errors as ESLint errors.
      'prettier/prettier': 'error',

      // Allow non-null assertions where TypeScript narrowing falls short.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Unused vars are caught by tsc; allow underscore-prefixed params.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Template literals with numbers are intentional in error messages.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],

      // Stub classes legitimately use async without await.
      '@typescript-eslint/require-await': 'off',

      // Import ordering (replaces eslint-plugin-import/order).
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
          ],
          newlinesBetween: 1,
        },
      ],

      // Auto-remove unused imports.
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // Prevent instanceof checks (error detection best practice).
      'no-instanceof/no-instanceof': 'error',
    },
  },
  // Tests keep every type-aware rule on. Only rules that fight idiomatic
  // Jest code are relaxed: `jest.fn()` mocks and `.rejects` matchers are
  // deliberately loosely typed, and `unbound-method` misfires on passing
  // `store.method` references into `expect(...)`.
  {
    files: ['test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', '*.config.*', 'reports/'],
  },
);
