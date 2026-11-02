import { test, expect, openApp } from './fixtures';

test('asset graph provides contextual details and view controls', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('raptix.activeProjectId', 'proj-lab-web'));
  await openApp(page, 'asset-management');
  await page.locator('#asset-graph-tab').click();
  await expect(page.locator('#asset-graph-status')).toContainText('relationships');
  const canvas = page.locator('#asset-graph-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await expect(page.locator('#asset-graph-explorer')).toBeHidden();
  await canvas.screenshot({ path: testInfo.outputPath('asset-graph.png') });
  await canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: import('cytoscape').Core } })._cyreg.cy;
    cy.nodes().first().emit('tap');
  });
  await expect(page.locator('#asset-graph-explorer')).toBeVisible();
  await expect(page.locator('#asset-graph-inspector')).toContainText('recorded connections');
  await expect(page.getByRole('heading', { name: 'Node identity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Linked asset records' })).toBeVisible();
  await page.locator('#asset-graph-panel').screenshot({ path: testInfo.outputPath('asset-graph-selected.png') });
  const visible = await canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: import('cytoscape').Core } })._cyreg.cy;
    const box = cy.nodes(':selected').renderedBoundingBox();
    return box.x1 >= 0 && box.y1 >= 0 && box.x2 <= cy.width() && box.y2 <= cy.height();
  });
  expect(visible).toBe(true);
  const connection = page.locator('.asm-connections button').first();
  if (await connection.count()) {
    const target = await connection.locator('.asm-connection-target').textContent();
    await connection.click();
    await expect(page.locator('.asm-node-name')).toHaveText(target!);
  }
  await page.getByRole('button', { name: 'Collapse' }).click();
  await expect(page.locator('#asset-graph-inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('#asset-graph-inspector')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#asset-graph-explorer')).toBeHidden();
  await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: import('cytoscape').Core } })._cyreg.cy.nodes().first().emit('tap'));
  await page.getByRole('button', { name: 'Close node details' }).click();
  await expect(page.locator('#asset-graph-explorer')).toBeHidden();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.locator('#asset-graph-search').fill('no-such-record.example');
  await expect(page.locator('#asset-graph-status')).toContainText('0 nodes');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.locator('#asset-graph-status')).not.toContainText('0 nodes');
});

test('graph remains usable on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'asset-management');
  await page.locator('#asset-graph-tab').click();
  await expect(page.locator('#asset-graph-canvas canvas').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#asset-graph-explorer')).toBeHidden();
  await page.locator('#asset-graph-canvas').evaluate(element => (element as HTMLElement & { _cyreg: { cy: import('cytoscape').Core } })._cyreg.cy.nodes().first().emit('tap'));
  await expect(page.locator('#asset-graph-explorer')).toBeVisible();
  await page.locator('#asset-graph-panel').screenshot({ path: testInfo.outputPath('asset-graph-selected-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
