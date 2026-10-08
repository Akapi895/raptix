import { defineConfig } from '@playwright/test'

// Run against the already-running Docker entrypoint; no dev server or API fixtures.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/deployed-smoke.spec.ts',
  outputDir: './test-results-deployed',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', channel: 'chromium', trace: 'retain-on-failure' },
})
