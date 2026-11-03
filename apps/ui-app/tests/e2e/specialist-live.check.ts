/** Production UI → actual BFF/runtime check; use the disposable integration stack. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const api = process.env.SPECIALIST_TEST_API_URL ?? 'http://127.0.0.1:58039';
const ui = process.env.SPECIALIST_TEST_UI_URL ?? 'http://127.0.0.1:55139';
const login = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'controlled-test', password: 'controlled-test-password' }) });
assert.equal(login.status, 200);
const { token } = await login.json() as { token: string };
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const response = await fetch(api + '/api/projects?limit=200', { headers });
const { projects } = await response.json() as { projects: { id: string; name: string }[] };
const project = projects.find(p => p.name === 'Controlled project A');
assert.ok(project, 'Run the specialist HTTP acceptance fixture first');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ colorScheme: 'light', viewport: { width: 1440, height: 1000 } });
  await page.goto(`${ui}/${project.id}/#agents`);
  await page.locator('#login-username').fill('controlled-test');
  await page.locator('#login-password').fill('controlled-test-password');
  await page.locator('#login-form button[type="submit"]').click();
  const grid = page.locator('#specialists-list');
  await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'));
  await grid.getByRole('button', { name: /Recon/ }).first().click();
  const modal = page.locator('#specialist-modal');
  await modal.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('specialist-modal')?.getAttribute('aria-busy') === 'false');
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  await modal.locator('[data-specialist-capability-search]').fill('cve_lookup');
  await modal.locator('input[value="tool:cve_lookup"]').check();
  await modal.locator('[data-specialist-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-specialist-status]')?.textContent?.startsWith('Saved. New runs'));
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'));
  await grid.getByRole('button', { name: /Recon/ }).first().click();
  await page.waitForFunction(() => document.getElementById('specialist-modal')?.getAttribute('aria-busy') === 'false');
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  await modal.locator('input[value="tool:cve_lookup"]').waitFor();
  assert.equal(await modal.locator('input[value="tool:cve_lookup"]').isChecked(), true);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await modal.locator('[data-specialist-capability-search]').fill('cve_lookup');
    assert.ok(await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: `test-results/specialist-live-${width}.png`, fullPage: true });
  }
  const run = await fetch(api + '/api/eino-agent', { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, role: 'recon', message: 'Run the controlled capability probe after the UI save; no external target.' }) });
  assert.equal(run.status, 200);
  assert.equal((await run.json() as { status: string }).status, 'success');
  console.info('Verified production browser save/reload with the real capability catalog, responsive layouts, and successful new Recon execution after saving.');
} finally { await browser.close(); }
