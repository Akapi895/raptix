import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Rules are 'error' since ticket 69 cleared the last recorded warnings; the
// historical inventory lives in .scratch/web-improve-refactor/diagnostics.md.

export default tseslint.config(
  // Browser tooling scope: server/ is a separate workspace with its own
  // config; .scratch/ holds planning trackers; tools/ are node harnesses.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.ua/**', 'tools/**', 'server/**', '.scratch/**', 'test-results*/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
)
