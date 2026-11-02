import { test, expect, openApp } from './fixtures';

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
