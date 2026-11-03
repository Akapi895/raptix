import { expect, openApp, test } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

// The conversation's attack chain is opened from its context menu: the header button is hidden, as it was before.
async function openAttackChain(page: Page): Promise<void> {
  // The row's menu button opens the conversation menu; the row sits in a folder that is collapsed by default, so the button is clicked as a script would.
  await page.locator('.conversation-item[data-conversation-id="conv-recon-01"] .conversation-item-menu').dispatchEvent('click');
  await page.locator('#attack-chain-menu-item').click();
}

async function visibleNodeCount(page: Page): Promise<number> {
  // The downloadable report collects the graph's visible nodes, so this asserts
  // the actual filter result through a public UI output, without a runtime hook.
  const downloaded = page.waitForEvent('download');
  await page.locator('#attack-chain-modal [data-i18n="attackChainModal.exportSvg"]').click();
  const file = await downloaded;
  const path = await file.path();
  if (!path) throw new Error('Missing attack-chain report');
  const svg = await readFile(path, 'utf8');
  return [...svg.matchAll(/<g filter="url\(#ac-shadow-card\)">/g)].length;
}

test('the attack chain of a conversation opens, draws its graph and closes', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');

  await openAttackChain(page);

  await expect(page.locator('#attack-chain-modal')).toBeVisible();
  await expect(page.locator('#attack-chain-container canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#attack-chain-container .loading-spinner')).toHaveCount(0);

  await page.locator('#attack-chain-modal .modal-close').click();
  await expect(page.locator('#attack-chain-modal')).toBeHidden();
});

test('the attack chain filters narrow the drawn graph, and reset brings every node back', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');
  await openAttackChain(page);
  await expect(page.locator('#attack-chain-container canvas').first()).toBeVisible({ timeout: 15_000 });

  const visibleNodes = () => visibleNodeCount(page);
  const total = await visibleNodes();
  expect(total).toBeGreaterThan(0);

  await page.locator('#attack-chain-type-filter').selectOption('target');
  const targets = await visibleNodes();
  expect(targets).toBeGreaterThan(0);
  expect(targets).toBeLessThan(total);

  await page.locator('#attack-chain-modal [data-i18n="attackChainModal.resetFilter"]').click();
  expect(await visibleNodes()).toBe(total);
});

test('the attack chain exports as an SVG report that the browser downloads', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');
  await openAttackChain(page);
  await expect(page.locator('#attack-chain-container canvas').first()).toBeVisible({ timeout: 15_000 });

  const download = page.waitForEvent('download');
  await page.locator('#attack-chain-modal [data-i18n="attackChainModal.exportSvg"]').click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^attack-chain-conv-recon-01-\d+\.svg$/);
});
