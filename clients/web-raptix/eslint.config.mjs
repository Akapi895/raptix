import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    // `server/` is the nested @raptix/web-raptix-server API package with its
    // own eslint config/gates (including its generated Prisma client under
    // server/src/generated/**); the browser lint run must not scan it.
    ignores: ['dist', 'node_modules', '.figma', 'docs/design-reference', 'test-results', 'test-results-real', 'playwright-report', 'server/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Phase 2 flips this to 'error' after the unused-import cleanup (W04–W08).
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright*.config.ts', 'eslint.config.mjs', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
