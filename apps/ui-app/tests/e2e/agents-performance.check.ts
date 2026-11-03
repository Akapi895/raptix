/** Opt-in production browser timing: RAPTIX_UI_URL=http://localhost:5173 node --import tsx tests/e2e/agents-performance.check.ts */
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests: { path: string; totalMs: number; ttfbMs: number; downloadMs: number; bytes: number }[] = [];
  const pending: Promise<void>[] = [];
  const errors: string[] = [];
  const apiFailures: { path: string; status: number }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) apiFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('requestfinished', request => {
    if (!request.url().includes('/api/specialists')) return;
    pending.push((async () => {
      const timing = request.timing();
      const sizes = await request.sizes();
      requests.push({ path: new URL(request.url()).pathname, totalMs: Math.round(timing.responseEnd),
        ttfbMs: Math.round(timing.responseStart - timing.requestStart), downloadMs: Math.round(timing.responseEnd - timing.responseStart), bytes: sizes.responseBodySize });
    })());
  });
  await page.goto((process.env.RAPTIX_UI_URL ?? 'http://localhost:5173') + '/#agents');
  await page.locator('#login-username').fill(process.env.RAPTIX_TEST_USERNAME ?? 'admin');
  await page.locator('#login-password').fill(process.env.RAPTIX_TEST_PASSWORD ?? 'admin123');
  await page.locator('#login-form button[type="submit"]').click();
  const modal = page.locator('#specialist-modal');
  await page.locator('#specialists-list .agent-card-specialist').first().waitFor();
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      if ((event.target as Element).closest('[data-specialist-section]')) performance.mark('agents-tab-start');
    }, true);
    document.addEventListener('click', event => {
      if ((event.target as Element).closest('[data-specialist-section]')) performance.measure('agents-tab-render', 'agents-tab-start');
    });
  });
  const measurements: { id: string; openMs: number; skillsMs: number; toolsMs: number; skillRows: number; toolRows: number }[] = [];
  for (const id of ['recon', 'recon', 'analyst', 'exploit', 'recon']) {
    const card = page.locator(`[data-specialist-id="${id}"]`);
    await card.waitFor();
    const started = performance.now();
    await card.click();
    await expect(modal).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
    await expect(modal.locator('[data-specialist-content]')).toContainText('Effective configuration');
    const openMs = Math.round(performance.now() - started);
    if (process.env.RAPTIX_CAPTURE && !measurements.length) await page.screenshot({ path: 'test-results/agents-polish-overview.png' });
    let startedTab = performance.now();
    await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
    const skillsMs = Math.round(performance.now() - startedTab);
    const skillRows = await modal.locator('[data-capability-text]').count();
    startedTab = performance.now();
    await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
    const toolsMs = Math.round(performance.now() - startedTab);
    const toolRows = await modal.locator('[data-capability-text]').count();
    measurements.push({ id, openMs, skillsMs, toolsMs, skillRows, toolRows });
    if (process.env.RAPTIX_CAPTURE && measurements.length === 1) {
      await page.screenshot({ path: 'test-results/agents-performance-tools.png' });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: 'test-results/agents-polish-mobile.png' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: 'test-results/agents-polish-dark.png' });
      console.info('Dark-theme audit', await audit());
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      console.info('Light-theme audit', await audit());
    }
    await modal.locator('[data-specialist-close]').click();
  }
  await Promise.all(pending);
  if (process.env.RAPTIX_CAPTURE) {
    await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await page.screenshot({ path: 'test-results/agents-polish-persona.png' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'test-results/agents-polish-persona-mobile.png' });
  }
  const renderMs = await page.evaluate(() => performance.getEntriesByName('agents-tab-render').map(entry => Math.round(entry.duration * 10) / 10));
  console.info(JSON.stringify({ measurements, renderMs, requests, errors, apiFailures }, null, 2));
  expect(errors).toEqual([]);

  async function audit(): Promise<unknown> {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const panel = document.querySelector<HTMLElement>('#specialist-modal .modal-content')!;
      const background = getComputedStyle(panel).backgroundColor;
      const contrast: Record<string, number> = {};
      for (const selector of ['.specialist-modal-description', '.specialist-help', '.specialist-capability strong', '.specialist-capability small', '.specialist-origin', '.specialist-refresh', '.specialist-capability-detail summary']) {
        const element = panel.querySelector<HTMLElement>(selector)!;
        const luminances: number[] = [];
        for (const color of [background, getComputedStyle(element).color]) {
          context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const rgb = context.getImageData(0, 0, 1, 1).data;
          const channels = [...rgb].slice(0, 3).map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
          luminances.push(channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722);
        }
        const [bg, fg] = luminances as [number, number];
        contrast[selector] = Math.round((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) * 100) / 100;
      }
      return { contrast, dialog: panel.parentElement?.getAttribute('role'), overflow: panel.scrollWidth > panel.clientWidth + 1,
        tabCount: panel.querySelectorAll('[role="tab"]').length, selectedTabs: panel.querySelectorAll('[role="tab"][aria-selected="true"]').length,
        scrollingRegion: getComputedStyle(panel.querySelector('[data-specialist-content]')!).overflowY };
    });
  }
} finally { await browser.close(); }
