import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'browser.spec.ts', workers: 1, timeout: 60000,
  outputDir: join(tmpdir(), 'opencode', 'projects-playwright-results'),
  use: { headless: true, viewport: { width: 1440, height: 1000 } },
});
