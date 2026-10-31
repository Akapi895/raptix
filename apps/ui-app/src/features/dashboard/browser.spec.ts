import { test, expect, openApp } from '../../../tests/e2e/fixtures';

test('dashboard migrates shell handlers, retains charts/tooltips and supports keyboard filtered navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await expect(page.locator('#dashboard-vuln-total')).not.toHaveText(/[….-]/);
  await expect(page.locator('#page-dashboard [onclick], #page-dashboard [onkeydown], #page-dashboard [onchange]')).toHaveCount(0);
  await expect(page.locator('#dashboard-tools-bar-chart .dashboard-tools-bar-item').first()).toBeVisible();
  await page.locator('#dashboard-tools-bar-chart .dashboard-tools-bar-item').first().hover();
  await expect(page.locator('.dashboard-tools-bar-tooltip')).toBeVisible();
  const legend = page.locator('.dashboard-severity-legend-item[data-severity="critical"]');
  await legend.hover();
  await expect(page.locator('#dashboard-severity-donut')).toHaveAttribute('data-hover-severity', 'critical');
  await expect(page.locator('.dashboard-severity-donut-tooltip')).toBeVisible();
  await page.locator('#dashboard-severity-status-filter-btn').click();
  await page.locator('.dashboard-severity-status-filter-option[data-status="fixed"]').click();
  await expect(page.locator('#dashboard-severity-status-filter')).toHaveAttribute('data-value', 'fixed');
  await expect(page.locator('#dashboard-severity-status-filter-menu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('raptix.dashboard.severityStatusFilter'))).toBe('fixed');
  await legend.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#vulnerabilities\?severity=critical&status=fixed$/);
});

test('dashboard feeds, access tabs, fact deep links and alert dismissal retain behavior', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#dashboard-recent-vulns .dashboard-recent-vuln-item').first()).toBeVisible();
  await page.locator('#dashboard-feed-tab-facts').click();
  await expect(page.locator('#dashboard-feed-panel-facts')).toBeVisible();
  await expect(page.locator('#dashboard-feed-tab-facts')).toHaveAttribute('aria-selected', 'true');
  const fact = page.locator('#dashboard-recent-facts .dashboard-recent-fact-item').first();
  await expect(fact).toBeVisible();
  await page.locator('#dashboard-access-tab-webshell').click();
  await expect(page.locator('#dashboard-access-panel-webshell')).toBeVisible();
  await expect(page.locator('#dashboard-access-view-all')).toHaveAttribute('data-page', 'webshell');
  await expect(page.locator('#dashboard-alert-banner')).toBeVisible();
  await page.locator('#dashboard-alert-close').click();
  await expect(page.locator('#dashboard-alert-banner')).toBeHidden();
  await page.locator('[data-action="refresh"]').click();
  await expect(page.locator('#dashboard-alert-banner')).toBeHidden();
  await fact.click();
  await expect(page.locator('#page-projects.active')).toBeVisible();
  await expect(page.locator('#project-tab-facts')).toBeVisible();
});

test('dashboard filter/menu persists, closes outside and on Escape and rerenders theme', async ({ page }) => {
  await openApp(page);
  await page.locator('#dashboard-severity-status-filter-btn').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#dashboard-severity-status-filter-menu')).toBeHidden();
  await page.locator('#dashboard-severity-status-filter-btn').click(); await page.locator('#dashboard-last-updated').click();
  await expect(page.locator('#dashboard-severity-status-filter-menu')).toBeHidden();
  await page.locator('#dashboard-severity-status-filter-btn').click(); await page.locator('.dashboard-severity-status-filter-option[data-status="open"]').click();
  await page.reload();
  await expect(page.locator('#dashboard-severity-status-filter')).toHaveAttribute('data-value', 'open');
  await expect(page.locator('#dashboard-severity-status-filter-text')).toHaveText('Open');
  await expect(page.locator('#dashboard-severity-center-label')).toHaveText('Total vulnerabilities');
  await page.locator('#theme-toggle-btn').click();
  await expect(page.locator('#dashboard-severity-donut-defs #donut-track-face stop').first()).toHaveAttribute('stop-color', /#(334155|f8fafc)/);
});

test('legacy consumers of dashboard helpers still render token charts, audit and HITL', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-action="token-usage"]').click();
  await expect(page).toHaveURL(/#settings\?section=token-usage$/);
  await expect(page.locator('#settings-token-analysis svg').first()).toBeVisible();
  await page.locator('.settings-nav-item[data-section="audit"]').click();
  await expect(page.locator('#audit-log-list')).toBeVisible();
  await expect(page.locator('#audit-log-list')).not.toBeEmpty();
  await page.evaluate(() => { location.hash = 'hitl'; });
  await expect(page.locator('#hitl-pending-list')).toBeVisible();
  await expect(page.locator('#hitl-pending-list')).not.toBeEmpty();
});
