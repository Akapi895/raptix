import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results-real',
  testMatch: process.env.W03_LIVE_GATE === '1' ? ['**/real-projects-live.spec.ts'] : ['**/real-mode.spec.ts', '**/real-projects.spec.ts', '**/real-console.spec.ts', '**/real-findings.spec.ts'],
  use: { baseURL: 'http://127.0.0.1:5276', channel: 'chromium' },
  webServer: { command: 'npm run dev -- --port 5276 --strictPort', url: 'http://127.0.0.1:5276', reuseExistingServer: false, env: { VITE_DATA_MODE: 'real' } },
})
