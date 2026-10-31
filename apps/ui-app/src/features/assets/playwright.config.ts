import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({ testDir: '.', testMatch: 'browser.spec.ts', workers: 1, fullyParallel: false, timeout: 60000, reporter: 'list', outputDir: join(tmpdir(), 'opencode', 'assets-browser-results'), use: { headless: true } });
