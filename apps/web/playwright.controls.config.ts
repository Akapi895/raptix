import { defineConfig } from '@playwright/test'

const workspace = process.env.W11_TEST_WORKSPACE
const database = process.env.W11_TEST_DATABASE_URL
if (!workspace || !database || !database.includes('/raptix_web_w02_fresh_20261001')) throw new Error('W11 gate requires the dedicated test DB and temporary workspace')

export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/real-controls-live.spec.ts', outputDir: './test-results-console', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5279', channel: 'chromium' },
  webServer: [
    { command: 'npm run start --workspace=@raptix/web-raptix-server', url: 'http://127.0.0.1:5286/api/health', reuseExistingServer: false, env: { PORT: '5286', HOST: '127.0.0.1', DATABASE_URL: database, WORKSPACE_PATH: workspace, LANGGRAPH_API_URL: 'http://127.0.0.1:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' } },
    { command: 'npm run dev -- --port 5279 --strictPort', url: 'http://127.0.0.1:5279', reuseExistingServer: false, env: { VITE_DATA_MODE: 'real', RAPTIX_WEB_BACKEND_URL: 'http://127.0.0.1:5286' } },
  ],
})
