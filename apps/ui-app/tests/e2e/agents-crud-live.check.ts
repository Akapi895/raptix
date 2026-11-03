/** Opt-in real-stack check: node --import tsx tests/e2e/agents-crud-live.check.ts */
import { chromium, expect as baseExpect, request } from '@playwright/test';
import type { SpecialistConfiguration } from '@raptix/web-contracts';

const baseURL = process.env.RAPTIX_UI_URL ?? 'http://localhost:5173';
const username = process.env.RAPTIX_TEST_USERNAME ?? 'admin';
const password = process.env.RAPTIX_TEST_PASSWORD ?? 'admin123';
const name = `agents-live-${Date.now()}`;
const expect = baseExpect.configure({ timeout: 30000 });
const loginClient = await request.newContext({ baseURL });
const login = await loginClient.post('/api/auth/login', { data: { username, password } });
expect(login.ok()).toBe(true);
const { token } = await login.json() as { token: string };
const api = await request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
const browser = await chromium.launch();
let originalConfiguration: SpecialistConfiguration | undefined;
let configurationChanged = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#agents');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-overlay')).toBeHidden();
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const editor = page.locator('#role-modal');
  await expect(editor.locator('#role-name')).toBeVisible({ timeout: 5000 });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.locator('#role-form-error')).toContainText('Agent name is required');
  await editor.locator('#role-name').fill(name);
  await editor.locator('#role-description').fill('Temporary Agents live-check persona');
  await editor.locator('#role-user-prompt').fill('Summarize evidence clearly.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  const card = page.locator('#roles-list .agent-card-persona').filter({ hasText: name });
  await expect(card).toBeVisible();
  expect((await (await api.get('/api/roles/' + encodeURIComponent(name))).json()).user_prompt).toBe('Summarize evidence clearly.');
  await page.reload();
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.locator('#role-user-prompt')).toHaveValue('Summarize evidence clearly.');
  await editor.locator('#role-description').fill('Updated temporary Agents live-check persona');
  await editor.locator('#role-user-prompt').fill('Include reproducible evidence references.');
  page.once('dialog', dialog => dialog.dismiss());
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await expect(card).toContainText('Updated temporary');
  expect((await (await api.get('/api/roles/' + encodeURIComponent(name))).json()).user_prompt).toBe('Include reproducible evidence references.');
  console.info('PASS: immediate create, field validation, prompt persistence, edit, reload, and discard guard');

  await page.locator('#main-sidebar [data-page="chat"] .nav-item-content').click();
  await expect(page.locator('#role-selector-wrapper')).toBeHidden();
  await expect(page.locator('#role-selection-list').getByText(name, { exact: true })).toHaveCount(1);
  console.info('VERIFIED LIMITATION: persona reaches the legacy selector registry, but current Chat hides it and has no persona execution adapter');
  await page.locator('#main-sidebar [data-page="agents"] .nav-item-content').click();
  await page.getByRole('tab', { name: 'Specialists', exact: true }).click();
  const originalResponse = await api.get('/api/specialists/recon/configuration');
  expect(originalResponse.ok()).toBe(true);
  originalConfiguration = await originalResponse.json() as SpecialistConfiguration;
  await page.locator('#specialists-list [data-specialist-id="recon"]').click();
  const specialist = page.locator('#specialist-modal');
  await expect(specialist).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
  await specialist.locator('[data-specialist-scope-toggle]').click();
  await specialist.locator('[data-specialist-scope-option="global"]').click();
  await expect(specialist).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
  await specialist.getByRole('tab', { name: 'Tools', exact: true }).click();
  await specialist.locator('input[data-capability-kind="tools"]:not(:disabled):not(:checked)').first().check();
  await expect(specialist.locator('[data-specialist-dirty]')).toHaveText('Unsaved changes');
  await specialist.getByRole('tab', { name: 'Overview', exact: true }).click();
  await specialist.getByRole('tab', { name: 'Tools', exact: true }).click();
  configurationChanged = true;
  await specialist.locator('[data-specialist-save]').click();
  await expect(specialist.locator('[data-specialist-status]')).toContainText('Saved. New runs', { timeout: 60000 });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await specialist.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  await specialist.locator('[data-specialist-close]').click();
  console.info('PASS: live specialist save, scope control, tab switching, and responsive modal');

  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  expect((await api.get('/api/roles/' + encodeURIComponent(name))).status()).toBe(404);
  expect(errors).toEqual([]);
  console.info('LIVE VERIFY OK: deletion persists; no page exceptions');
} finally {
  if (configurationChanged && originalConfiguration) {
    const current = await (await api.get('/api/specialists/recon/configuration')).json() as SpecialistConfiguration;
    const restored = await api.put('/api/specialists/recon/configuration', { data: { revision: current.revision, additions: originalConfiguration.global } });
    expect(restored.ok(), 'restore the operator’s original specialist additions').toBe(true);
  }
  await api.delete('/api/roles/' + encodeURIComponent(name));
  await browser.close();
  await api.dispose();
  await loginClient.dispose();
}
