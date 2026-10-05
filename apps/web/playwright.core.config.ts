import { defineConfig } from '@playwright/test'
const workspace = process.env.W15_TEST_WORKSPACE
const database = process.env.W15_TEST_DATABASE_URL
if (!workspace || !database || !database.includes('/raptix_web_w02_fresh_20261001')) throw new Error('W15 core gate requires the dedicated test DB and temporary workspace')
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/real-core-flow-live.spec.ts', outputDir: './test-results-core', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5296', channel: 'chromium' },
  webServer: [
    { command: 'npm run start --workspace=@raptix/web-raptix-server', url: 'http://127.0.0.1:5297/api/health', reuseExistingServer: false, env: { PORT: '5297', HOST: '127.0.0.1', DATABASE_URL: database, WORKSPACE_PATH: workspace, LANGGRAPH_API_URL: 'http://127.0.0.1:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' } },
    { command: 'npm run dev -- --port 5296 --strictPort', url: 'http://127.0.0.1:5296', reuseExistingServer: false, env: { VITE_DATA_MODE: 'real', RAPTIX_WEB_BACKEND_URL: 'http://127.0.0.1:5297' } },
  ],
})
