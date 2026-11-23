import { test, expect, openApp } from './fixtures';

const pages = [
  'dashboard', 'chat', 'hitl', 'tool-guard', 'asset-library',
  'info-collect', 'projects', 'vulnerabilities', 'webshell', 'chat-files',
  'mcp-monitor', 'mcp-management', 'knowledge-management', 'knowledge-retrieval-logs',
  'agents', 'specialist-management', 'roles-management', 'workflows', 'skills-monitor', 'skills-management',
  'settings', 'tasks', 'c2-listeners', 'c2-sessions', 'c2-tasks',
  'c2-payloads', 'c2-events', 'c2-profiles',
] as const;

for (const route of pages) {
  test(`direct hash route: ${route}`, async ({ page }) => {
    await openApp(page, route);
    // The automatic browserHealth fixture records every missing mock route,
    // including deferred subscriptions, without a diagnostic browser global.
    await page.waitForTimeout(1200);
    await expect(page.locator('.page.active')).toHaveCount(1);
  });
}

test('dashboard data and navigation', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#dashboard-vuln-total')).toHaveText('6');
  const operationCenter = page.locator('.nav-item[data-page="projects"]');
  await expect(operationCenter).toContainText('Operation Center');
  await expect(operationCenter.locator('.nav-item-content')).toHaveAttribute('data-title', 'Operation Center');
  await operationCenter.click();
  await expect(page).toHaveURL(/#operation-center$/);
  await expect(operationCenter).toHaveClass(/active/);
  await expect(page.locator('#page-projects h2')).toHaveText('Operation Center');
  await page.reload();
  await expect(page.locator('#page-projects')).toHaveClass(/active/);
  await page.goto('/#projects?project=p1');
  await expect(page).toHaveURL(/#operation-center\?project=p1$/);
  await expect(page.locator('#page-projects')).toHaveClass(/active/);
});

test('API documentation has its own entry', async ({ page }) => {
  await page.goto('/api-docs');
  await expect(page.locator('.api-docs-container')).toBeVisible();
  await expect(page.locator('#csai-mock-badge')).toBeVisible();
});

test('narrow viewports build the mobile tab bar and drawer head', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'chat');
  await expect(page.locator('#m-tabbar')).toBeVisible();
  await expect(page.locator('#main-sidebar .m-drawer-head')).toHaveCount(1);
});

test('desktop viewports do not build the mobile chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, 'chat');
  await expect(page.locator('#m-tabbar')).toHaveCount(0);
});

test('feature navigation shows concise names and canonical URLs, including old bookmarks', async ({ page }) => {
  await openApp(page);
  await page.addStyleTag({ content: '#csai-mock-badge { pointer-events: none; }' });
  for (const [internal, label, canonical, legacy] of [
    ['asset-management', 'Assets', 'assets', 'asset-management'],
    ['webshell', 'WebShell', 'webshell', 'webshell-management'],
    ['file-management', 'Files', 'files', 'file-management'],
    ['mcp-management', 'MCP', 'mcp-management', 'mcp'],
    ['settings', 'Settings', 'settings', 'system-settings'],
  ] as const) {
    const nav = internal === 'mcp-management' ? 'mcp' : internal;
    const link = page.locator(`.nav-item[data-page="${nav}"] .nav-item-content`);
    await expect(link).toContainText(label);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#${canonical}$`));
    await expect(page.locator(`#page-${internal}.active h2`).first()).toHaveText(label);
    await page.evaluate(hash => { location.hash = hash; }, `${legacy}?source=bookmark`);
    await expect(page).toHaveURL(new RegExp(`#${canonical}\\?source=bookmark$`));
    await expect(page.locator(`#page-${internal}.active`)).toBeVisible();
  }
});
