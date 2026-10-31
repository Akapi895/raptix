import { test, expect, openApp } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('raptix.activeProjectId', 'proj-lab-web'));
});

test('assets unify overview and inventory, follow filters, and respect project switching', async ({ page }) => {
  await openApp(page, 'asset-library');
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('3');
  await expect(page.locator('#asset-table-body .asset-target-link')).toHaveCount(3);
  await expect(page.locator('#main-sidebar [data-page="asset-overview"]')).toHaveCount(0);
  await page.locator('.asm-priorities [data-value="never"]').click();
  await expect(page.locator('#asset-table-body .asset-target-link')).toHaveCount(1);
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('1');
  await expect(page.locator('#asset-table-body')).toContainText('198.51.100.31');
  await page.locator('[data-assets-click="asset.reset"]').click();
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('3');
  await page.locator('#csai-project-switcher .csai-ps-trigger').click();
  await page.locator('.csai-ps-option').filter({ hasText: 'Internal API Review' }).click();
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('1');
  await expect(page.locator('#asset-table-body')).toContainText('api.example.com');
  await expect(page.locator('#asset-table-body')).not.toContainText('app.example.com');
});

test('graph supports evidence-based filtering, node exploration, and detail investigation', async ({ page }) => {
  await openApp(page, 'asset-library');
  await expect(page.locator('.asm-kpi')).toHaveCount(5);
  await page.locator('#asset-graph-tab').click();
  await expect(page.locator('#asset-inventory-panel')).toBeHidden();
  await expect(page.locator('#asset-graph-status')).toContainText('relationships');
  await expect(page.locator('#asset-graph-nodes option')).toContainText(['app.example.com']);
  await expect(page.locator('#asset-graph-nodes')).toContainText('Missing Content-Security-Policy header');
  await page.locator('#asset-graph-search').fill('app.example.com');
  await expect(page.locator('#asset-graph-nodes')).not.toContainText('Express');
  await page.locator('#asset-graph-nodes').selectOption({ label: 'domain: app.example.com' });
  await expect(page.locator('#asset-graph-inspector')).toContainText('recorded address');
  await page.locator('#asset-graph-inspector [data-assets-click="workspace.detail"]').first().click();
  await expect(page.locator('#asset-detail-modal')).toBeVisible();
  await page.locator('#asset-evidence-tab-services').click();
  await expect(page.locator('#asset-evidence-services')).toContainText('443');
  await page.locator('#asset-evidence-tab-findings').click();
  await expect(page.locator('#asset-evidence-findings')).toContainText('Missing Content-Security-Policy header');
  await page.locator('#asset-evidence-tab-scans').click();
  await expect(page.locator('#asset-evidence-scans')).toContainText('latest scan reference only');
  await page.locator('#asset-evidence-tab-sitemap').click();
  await expect(page.locator('#asset-evidence-sitemap')).toContainText('No crawl data available');
  await page.keyboard.press('Escape');
  await expect(page.locator('#asset-detail-modal')).toBeHidden();
  await page.locator('#asset-graph-search').fill('no-such-record.example');
  await expect(page.locator('#asset-graph-status')).toContainText('0 nodes');
  await expect(page.locator('#asset-graph-nodes option')).toHaveCount(0);
});

test('discovery keeps provider capabilities and selectively imports into the selected project', async ({ page }) => {
  await openApp(page, 'info-collect');
  await expect(page.locator('#asset-discover-import')).toBeDisabled();
  await expect(page.locator('.asm-discovery-options')).not.toHaveAttribute('open');
  await page.locator('#fofa-query').fill('domain="example.com"');
  await page.locator('#fofa-query-submit-btn').click();
  await expect(page.locator('.fofa-row-select').first()).toBeVisible();
  await expect(page.locator('#fofa-results-tbody')).toContainText('Lab Portal');
  await expect(page.locator('#fofa-results-meta')).toContainText('Total 2');
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { assetImportBody?: unknown };
    const original = target.fetch;
    target.fetch = (input, init) => {
      if (String(input).includes('/api/assets/import') && typeof init?.body === 'string') target.assetImportBody = JSON.parse(init.body);
      return original(input, init);
    };
  });
  await page.locator('.fofa-row-select').first().check();
  await expect(page.locator('#asset-discover-import')).toBeEnabled();
  await page.locator('#asset-discover-import').click();
  await expect(page.locator('#asset-discover-import')).toBeDisabled();
  const body = await page.evaluate(() => (globalThis as typeof globalThis & { assetImportBody?: unknown }).assetImportBody);
  expect(body).toMatchObject({ source: 'fofa', source_query: 'domain="example.com"', assets: [{ project_id: 'proj-lab-web' }] });
  expect((body as { assets: unknown[] }).assets).toHaveLength(1);
  await page.locator('.asm-discovery-options summary').click();
  await expect(page.locator('#fofa-size')).toBeVisible();
  await expect(page.locator('#fofa-fields')).toBeVisible();
});

test('old overview bookmarks open the unified workspace', async ({ page }) => {
  await page.goto('/?mock-reset=1#asset-overview');
  await expect(page).toHaveURL(/#asset-library$/);
  await expect(page.locator('#page-asset-overview')).toHaveCount(0);
  await expect(page.locator('#page-asset-library')).toBeVisible();
});

test('inventory loading failures are recoverable and empty filters do not show invented data', async ({ page }) => {
  await openApp(page, 'asset-library');
  await expect(page.locator('.asm-kpi')).toHaveCount(5);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) => String(input).includes('/api/assets?')
      ? Promise.resolve(Response.json({ error: 'Temporary asset read failure' }, { status: 500 })) : original(input, init);
    (window as typeof window & { restoreAssetFetch?: () => void }).restoreAssetFetch = () => { window.fetch = original; };
  });
  await page.locator('#page-asset-library .page-header [data-assets-click="asset.load"]').click();
  await expect(page.locator('#asset-workspace-summary')).toContainText('Could not load');
  await expect(page.locator('#asset-table-body')).toContainText('Retry');
  await page.evaluate(() => (window as typeof window & { restoreAssetFetch?: () => void }).restoreAssetFetch?.());
  await page.locator('#asset-workspace-summary [data-assets-click="asset.load"]').click();
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('3');
  await page.locator('#asset-search').fill('no-such-asset.example');
  await page.locator('#asset-search').press('Enter');
  await expect(page.locator('#asset-table-body')).toContainText('No assets found');
  await expect(page.locator('.asm-kpi').first().locator('strong')).toHaveText('0');
});

for (const width of [390, 768, 1440]) {
  test(`asset inventory, graph and discovery fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page, 'asset-library');
    await expect(page.locator('.asm-kpi')).toHaveCount(5);
    if (width === 390) {
      await expect(page.locator('#asset-workspace-insights')).toBeHidden();
      await page.locator('#asset-insights-toggle').click();
      await expect(page.locator('#asset-workspace-insights')).toBeVisible();
      await page.locator('#asset-insights-toggle').click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#asset-graph-tab').click();
    await expect(page.locator('#asset-graph-canvas')).toBeVisible();
    await expect(page.locator('#asset-inventory-panel')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/#info-collect');
    await expect(page.locator('#fofa-query')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
