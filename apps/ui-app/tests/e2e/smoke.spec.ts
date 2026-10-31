import { test, expect, openApp } from './fixtures';

const pages = [
  'dashboard', 'chat', 'hitl', 'tool-guard', 'asset-library',
  'info-collect', 'projects', 'vulnerabilities', 'webshell', 'chat-files',
  'mcp-monitor', 'mcp-management', 'knowledge-management', 'knowledge-retrieval-logs',
  'roles-management', 'workflows', 'skills-monitor', 'skills-management',
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
