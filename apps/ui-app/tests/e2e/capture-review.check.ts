import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('.impeccable/review', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ colorScheme: 'light', viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4199/?mock-reset=1#agents');
  await page.locator('#login-overlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.impeccable/review/desktop.png', fullPage: true });

  await page.locator('#specialists-list .agent-card-specialist').first().click();
  await page.waitForFunction(() => document.getElementById('specialist-modal')?.getAttribute('aria-busy') === 'false');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '.impeccable/review/desktop-modal.png', fullPage: true });
  await page.locator('#specialist-modal').getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.screenshot({ path: 'test-results/agents-polish-tools.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.impeccable/review/desktop-custom.png', fullPage: true });
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.locator('#role-name').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/agents-polish-create.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/agents-polish-create-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Specialists', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
  console.info('captured 4 screenshots into .impeccable/review/');
} finally { await browser.close(); }
