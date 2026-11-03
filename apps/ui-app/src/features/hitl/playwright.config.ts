import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// In-memory bundle + routed HTML; no dev server, shared build, or preview port.
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: 'browser.spec.ts',
  workers: 1, timeout: 30_000,
  outputDir: join(tmpdir(), 'opencode', 'hitl-browser-results'),
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
