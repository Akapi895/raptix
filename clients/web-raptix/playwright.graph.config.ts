import { defineConfig } from '@playwright/test'
const workspace = process.env.W13_TEST_WORKSPACE
const database = process.env.W13_TEST_DATABASE_URL
const neo4jPassword = process.env.W13_NEO4J_PASSWORD
if (!workspace || !database || !database.includes('/raptix_web_w02_fresh_20261001')) throw new Error('W13 gate requires the dedicated test DB and temporary workspace')
if (!neo4jPassword || neo4jPassword === 'raptix-graph') throw new Error('W13 gate requires the real Neo4j password (never the public default)')
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/real-graph-live.spec.ts', outputDir: './test-results-graph', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5292', channel: 'chromium' },
  webServer: [
    { command: 'npm run start --workspace=@raptix/web-raptix-server', url: 'http://127.0.0.1:5293/api/health', reuseExistingServer: false, env: { PORT: '5293', HOST: '127.0.0.1', DATABASE_URL: database, WORKSPACE_PATH: workspace, LANGGRAPH_API_URL: 'http://127.0.0.1:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace', NEO4J_HTTP_URI: 'http://127.0.0.1:7475', NEO4J_USER: 'neo4j', NEO4J_PASSWORD: neo4jPassword } },
    { command: 'npm run dev -- --port 5292 --strictPort', url: 'http://127.0.0.1:5292', reuseExistingServer: false, env: { VITE_DATA_MODE: 'real', RAPTIX_WEB_BACKEND_URL: 'http://127.0.0.1:5293' } },
  ],
})
