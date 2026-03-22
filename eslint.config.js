import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import noInstanceof from 'eslint-plugin-no-instanceof';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
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
  // Disable type-checked rules for test files (not in tsconfig include).
  {
    files: ['tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', '*.config.*'],
  },
);
