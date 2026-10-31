import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';

test('production uses the backend and contains no mock fixture', async ({ page }) => {
  let backendRequests = 0;
  await page.route('**/api/**', async route => {
    backendRequests++;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"not authenticated"}' });
  });
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('#login-overlay')).toBeVisible();
  // HITL uses apiFetch, which waits for authentication. A login shell is usable
  // while initializing, but must not claim authenticated initialization is done.
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'loading');
  await expect(page.locator('#csai-mock-badge')).toHaveCount(0);
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('not-a-demo');
  await page.locator('#login-form button[type="submit"]').click();
  await expect.poll(() => backendRequests).toBeGreaterThan(0);
  await expect(page.locator('#login-overlay')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'loading');
  const files = await readdir('dist', { recursive: true });
  for (const file of files.filter(file => /\.(js|html|map)$/.test(file))) {
    const content = await readFile(`dist/${file}`, 'utf8');
    expect(content, file).not.toContain('csai-mock-state-v1');
    expect(content, file).not.toContain('fictional');
    expect(content, file).not.toContain('mock-session-');
  }
});

test('production readiness waits for authenticated HITL defaults and translations without deadlock', async ({ page }) => {
  let releaseDefaults: () => void = () => {};
  let requestedDefaults: () => void = () => {};
  const defaultsRequested = new Promise<void>(resolve => { requestedDefaults = resolve; });
  const defaultsReleased = new Promise<void>(resolve => { releaseDefaults = resolve; });
  await page.addInitScript(() => {
    localStorage.setItem('raptix-auth', JSON.stringify({ token: 'e2e-backend-session',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), permissions: ['*'], roles: ['admin'], scope: 'all' }));
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/hitl/default-config') {
      requestedDefaults();
      await defaultsReleased;
      await route.fulfill({ json: { defaultMode: 'approval', defaultReviewer: 'human', defaultTimeoutSeconds: 120 } });
    } else if (path === '/api/auth/validate') {
      await route.fulfill({ json: { valid: true, permissions: ['*'], roles: ['admin'], scope: 'all' } });
    } else {
      await route.fulfill({ status: 403, json: { error: 'Forbidden by test backend' } });
    }
  });
  await page.goto('http://127.0.0.1:4174/');
  await defaultsRequested;
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'loading');
  await expect(page.locator('#theme-toggle-label')).not.toBeEmpty();
  releaseDefaults();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#csai-mock-badge')).toHaveCount(0);
  await expect(page.locator('#hitl-mode-select')).toHaveValue('approval');
  await expect(page.locator('#hitl-timeout-select')).toHaveValue('120');
  expect(await page.evaluate(() => ['csaiHitlDefaultConfigReady', 'csaiHitlDefaultConfig'].filter(name => Reflect.has(globalThis, name)))).toEqual([]);
});
