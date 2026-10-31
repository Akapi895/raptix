import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { architecture } from './build/eslint-architecture.js';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-demo/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    plugins: { architecture },
    rules: {
      'architecture/boundaries': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/platform/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@/features/**', '@/ui/**', '@/mock/**', '../features/**', '../ui/**', '../mock/**'] }] },
  },
  {
    files: ['src/features/**/view.ts'],
    rules: { 'no-restricted-globals': ['error', 'fetch'] },
  },
  {
    files: ['src/features/**/*.ts', 'src/api/**/*.ts', 'src/platform/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@/mock/**', '**/mock/**', '@/legacy/**', '**/legacy/**'] }] },
  },
);
