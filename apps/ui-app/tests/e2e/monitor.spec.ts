import { expect, openApp, test } from './fixtures';

test('MCP monitor renders statistics and the executions table', async ({ page }) => {
  await openApp(page, 'mcp-monitor');
  await expect(page.locator('#monitor-stats .mcp-exec-stats, #monitor-stats .monitor-empty').first()).toBeVisible();
  await expect(page.locator('#monitor-executions .monitor-table tbody tr, #monitor-executions .monitor-empty').first()).toBeVisible();
});

test('MCP monitor status filter narrows the executions and keeps the choice', async ({ page }) => {
  await openApp(page, 'mcp-monitor');
  await page.locator('#page-mcp-monitor .monitor-filter-select-trigger').click();
  await page.locator('#page-mcp-monitor .monitor-filter-select-option[data-value="failed"]').click();
  await expect(page.locator('#monitor-status-filter')).toHaveValue('failed');
  await expect(page.locator('#page-mcp-monitor .monitor-filter-select-value')).toHaveText(/./);
  // The list reloads asynchronously: wait for the filtered result before checking its rows.
  const chips = page.locator('#monitor-executions .monitor-status-chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveClass(/failed/);
});
