import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/single-user.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5275', trace: 'retain-on-failure', screenshot: 'only-on-failure', channel: 'chromium' },
  webServer: { command: 'npm run preview -- --port 5275 --strictPort', url: 'http://127.0.0.1:5275', reuseExistingServer: false },
})
