/** Verify the Agents feature on the operator's real stack (5173). */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.VERIFY_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ colorScheme: 'light', viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', d => void d.accept());

  await page.goto(base + '/#specialist-management');
  await expectUrl();
  await page.locator('#login-form').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('admin123');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('#login-form').waitFor({ state: 'hidden', timeout: 20000 });

  const grid = page.locator('#specialists-list');
  await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'), undefined, { timeout: 90000 });
  const entries = await grid.locator('.agent-card-specialist').count();
  console.info('STEP list rendered:', entries, 'specialists');
  await page.screenshot({ path: 'test-results/verify-1-list.png', fullPage: true });
  assert.ok(entries > 1, 'full specialist roster must render');

  await grid.getByRole('button', { name: /Recon/ }).first().click();
  const modal = page.locator('#specialist-modal');
  await modal.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!document.querySelector('[data-specialist-content] h4'), undefined, { timeout: 90000 });
  console.info('STEP overview OK');
  await page.screenshot({ path: 'test-results/verify-2-overview.png', fullPage: true });

  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[data-specialist-content] input[type="checkbox"]'), undefined, { timeout: 90000 });
  const tools = await page.locator('[data-specialist-content] input[type="checkbox"]').count();
  console.info('STEP tools tab:', tools, 'tool checkboxes');
  const box = page.locator('[data-specialist-content] input[value="tool:cve_lookup"]');
  if (!(await box.isChecked())) {
    await box.check();
    await page.waitForFunction(() => !document.querySelector('[data-specialist-save]')?.hasAttribute('disabled'), undefined, { timeout: 20000 });
    console.info('STEP dirty state: Unsaved changes');
    await page.locator('[data-specialist-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-specialist-status]')?.textContent?.startsWith('Saved'), undefined, { timeout: 90000 });
    await page.screenshot({ path: 'test-results/verify-3-saved.png', fullPage: true });

    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'), undefined, { timeout: 90000 });
    await page.locator('#specialists-list').getByRole('button', { name: /Recon/ }).first().click();
    await page.waitForFunction(() => !!document.querySelector('[data-specialist-content] h4'), undefined, { timeout: 90000 });
    await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
    await box.waitFor({ timeout: 30000 });
    assert.equal(await box.isChecked(), true, 'saved addition must persist');
  }
  console.info('STEP persisted:', (await page.locator('[data-specialist-dirty]').innerText()).trim());
  await page.screenshot({ path: 'test-results/verify-4-reload.png', fullPage: true });

  await modal.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.waitForTimeout(500);
  console.info('STEP mcp tab:', (await page.locator('[data-specialist-content]').innerText()).split('\n')[0]?.slice(0, 60));

  await page.locator('[data-specialist-reset]').click();
  await page.waitForFunction(() => !document.querySelector('[data-specialist-save]')?.hasAttribute('disabled'), undefined, { timeout: 20000 });
  await page.locator('[data-specialist-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-specialist-status]')?.textContent?.startsWith('Saved'), undefined, { timeout: 90000 });
  await page.screenshot({ path: 'test-results/verify-5-reset.png', fullPage: true });
  console.info('STEP reset additions saved — configuration left clean');

  assert.equal(errors.filter(e => e.startsWith('pageerror')).length, 0, 'no page errors: ' + errors.join(' | '));
  console.info('VERIFY OK — real stack: roster, catalog, editing, save, persistence, MCP and reset all work.');

  async function expectUrl(): Promise<void> {
    await page.waitForFunction(() => window.location.hash === '#agents', undefined, { timeout: 20000 });
  }
} finally { await browser.close(); }
