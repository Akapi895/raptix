import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Domain-owned smoke checks against the demo production build, without changing shared config.
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: 'browser.spec.ts',
  workers: 1, timeout: 45_000, expect: { timeout: 12_000 },
  outputDir: join(tmpdir(), 'opencode', 'dashboard-e2e-results'),
  use: { baseURL: 'http://127.0.0.1:4186', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npm run preview:demo -- --port 4186 --strictPort${process.env.DASHBOARD_BUILD_DIR ? ` --outDir "${process.env.DASHBOARD_BUILD_DIR}"` : ''}`,
    url: 'http://127.0.0.1:4186', reuseExistingServer: false,
  },
});
