import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.claude/**',
      '**/dist/**',
      '**/build/**',
      '**/public/**',
      '**/coverage/**',
      '**/.understand-anything/**',
      '**/.claude-plugin/**',
      '**/.cursor-plugin/**',
      '**/.copilot-plugin/**',
      '**/.astro/**',
      '.private/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-irregular-whitespace': ['error', { skipComments: true }],
    },
  },
  {
    files: ['understand-anything-plugin/packages/dashboard/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs', '**/__tests__/**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/skills/**/workflow.js'],
    languageOptions: {
      globals: {
        agent: 'readonly',
        parallel: 'readonly',
        pipeline: 'readonly',
        log: 'readonly',
        phase: 'readonly',
        args: 'readonly',
        budget: 'readonly',
        workflow: 'readonly',
      },
    },
  },
);
