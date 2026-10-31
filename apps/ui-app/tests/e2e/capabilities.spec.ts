import { expect, openApp, test } from './fixtures';

const routes = ['mcp-management', 'mcp-monitor', 'knowledge-management', 'knowledge-retrieval-logs', 'skills-management', 'skills-monitor', 'roles-management'];

test('Capabilities sidebar opens management directly and stays active across internal tabs', async ({ page }) => {
  await openApp(page);
  for (const collapsed of [false, true]) {
    if (collapsed) await page.locator('[data-router-action="sidebar"]').click();
    for (const [group, primary, activity] of [
      ['mcp', 'mcp-management', 'mcp-monitor'],
      ['knowledge', 'knowledge-management', 'knowledge-retrieval-logs'],
      ['skills', 'skills-management', 'skills-monitor'],
    ]) {
      const item = page.locator(`#main-sidebar .nav-item[data-page="${group}"]`);
      await expect(item.locator('.nav-submenu, .submenu-arrow')).toHaveCount(0);
      const link = item.locator('.nav-item-content');
      await link.focus(); await link.press('Enter');
      await expect(page).toHaveURL(new RegExp(`#${primary}$`));
      await expect(item).toHaveClass(/active/);
      await expect(item).not.toHaveClass(/expanded/);
      await page.locator(`#page-${primary} .cap-local-nav a[href="#${activity}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${activity}$`));
      await expect(page.locator(`#page-${activity}.active`)).toBeVisible();
      await expect(item).toHaveClass(/active/);
      await expect(item).not.toHaveClass(/expanded/);
      await expect(page.locator('.submenu-popup')).toHaveCount(0);
      await page.locator(`#page-${activity} .cap-local-nav a[href="#${primary}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${primary}$`));
    }
  }
});

test('all Capabilities routes fit desktop and responsive widths without page overflow', async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [1366, 1440, 1920, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await openApp(page, route);
      const root = page.locator(`#page-${route}`);
      await expect(root.locator('h2')).toBeVisible();
      await expect(root.locator('.loading-spinner')).toHaveCount(0);
      await expect(root.locator('.cap-table, .monitor-table, .tool-item').first()).toBeVisible();
      expect(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${route} at ${width}px`).toBe(true);
      const content = root.locator('.page-content');
      expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${route} content at ${width}px`).toBe(true);
      if (route !== 'roles-management') await expect(root.locator('.cap-local-nav [aria-current="page"]')).toBeVisible();
    }
  }
});

test('capability editors keep keyboard focus inside and close with Escape', async ({ page }) => {
  for (const [route, action, id] of [
    ['mcp-management', '[data-settings-action="mcp-add"]', 'external-mcp-modal'],
    ['knowledge-management', '[data-action="knowledge.add"]', 'knowledge-item-modal'],
    ['skills-management', '[data-action="skills.edit"]', 'skill-modal'],
    ['skills-management', '[data-action="skills.view"]', 'skill-view-modal'],
    ['roles-management', '[data-action="roles.create"]', 'role-modal'],
    ['knowledge-retrieval-logs', '[data-action="knowledge.logDetails"]', 'retrieval-log-details-modal'],
  ] as const) {
    await openApp(page, route);
    await page.locator(action).first().click();
    const modal = page.locator(`#${id}`);
    await expect(modal).toHaveAttribute('role', 'dialog');
    const close = modal.locator('.modal-close');
    const last = modal.locator('.modal-footer button').last();
    await expect(last).toBeEnabled();
    await last.focus(); await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
    if (id === 'skill-view-modal') { await modal.locator('[data-action="skills.full"]').click(); await expect(modal.locator('[data-action="skills.full"]')).toBeEnabled(); }
    await page.keyboard.press('Escape'); await expect(modal).toBeHidden();
  }
});

test('MCP parameters support the keyboard and server configuration preserves validation, editing and deletion', async ({ page }) => {
  await openApp(page, 'mcp-management');
  const tool = page.locator('.tool-item').filter({ hasText: 'nmap_scan' });
  const parameters = tool.locator('.cap-schema-toggle');
  await parameters.focus(); await parameters.press('Enter');
  await expect(parameters).toHaveAttribute('aria-expanded', 'true');
  await expect(tool.locator('.tool-item-detail')).toContainText('Parameter schema');
  await parameters.press('Enter');
  await expect(tool.locator('.tool-item-detail')).toBeHidden();
  await page.locator('[data-settings-action="mcp-add"]').click();
  await expect(page.locator('#external-mcp-modal .cap-reference')).not.toHaveAttribute('open');
  await page.locator('#external-mcp-json').fill('{invalid');
  await page.locator('[data-settings-action="mcp-save"]').click();
  await expect(page.locator('#external-mcp-json-error')).toBeVisible();
  // Creation/upsert is verified by the settings browser integration fixture.
  // The legacy demo transport accepts updates only for existing server names.
  await page.locator('#external-mcp-json').fill(JSON.stringify({ 'lab-notes': { type: 'http', url: 'http://127.0.0.1:9100/mcp', timeout: 30 } }));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-settings-action="mcp-save"]').click();
  await expect(page.locator('#external-mcp-modal')).toBeHidden();
  const server = page.locator('.external-mcp-item[data-mcp-name="lab-notes"]');
  await expect(server).toBeVisible();
  await server.locator('[data-settings-action="mcp-edit"]').click();
  await expect(page.locator('#external-mcp-json')).toHaveValue(/lab-notes/);
  await page.locator('[data-settings-action="mcp-close"]').first().click();
  page.on('dialog', dialog => dialog.accept());
  await server.locator('[data-settings-action="mcp-delete"]').click();
  await expect(server).toHaveCount(0);
});

test('local navigation, native category filtering, retrieval details and agent availability work', async ({ page }) => {
  await openApp(page, 'knowledge-management');
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('auth');
  await expect(page.locator('.knowledge-category-section')).toHaveCount(1);
  await page.locator('#knowledge-search').fill('no such knowledge');
  await page.locator('#knowledge-search').press('Enter');
  await expect(page.locator('#knowledge-items-list')).toContainText('No matching knowledge');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.knowledge-category-section')).toHaveCount(3);
  await page.locator('#page-knowledge-management .cap-local-nav a[href="#knowledge-retrieval-logs"]').click();
  await expect(page).toHaveURL(/#knowledge-retrieval-logs$/);
  await page.locator('[data-action="knowledge.logDetails"]').first().click();
  await expect(page.locator('#retrieval-log-details-modal')).toContainText('refresh token rotation');
  await page.keyboard.press('Escape');
  await expect(page.locator('#retrieval-log-details-modal')).toBeHidden();
  await page.goto('/#roles-management');
  await page.locator('#roles-availability').selectOption('disabled');
  await expect(page.locator('.role-card')).toHaveCount(1);
  await expect(page.locator('.role-card')).toContainText('Report Writer');
  await page.locator('.role-card [data-action="roles.edit"]').click();
  await expect(page.locator('#role-modal')).toBeVisible();
  await expect(page.locator('#role-modal .cap-form-section').first()).toContainText('Identity');
  await expect(page.locator('#role-workflow-options')).not.toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await expect(page.locator('#role-modal')).toBeHidden();
});

test('MCP trend leaves loading, does not show an all-tools filter, and supports outcome selection', async ({ page }) => {
  await openApp(page, 'mcp-monitor');
  await expect(page.locator('.mcp-stats-combined__timeline-inner')).not.toContainText('Loading trend');
  await expect(page.locator('.mcp-stats-filter-chip')).toHaveCount(0);
  await expect(page.locator('#monitor-stats-subtitle')).not.toContainText('&#');
  await page.getByRole('checkbox', { name: 'Select all executions on this page' }).check();
  await expect(page.locator('#monitor-selected-count')).toContainText('4 selected');
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await expect(page.locator('#monitor-batch-actions')).toBeHidden();
});

test('retrieval failures are recoverable errors instead of empty history', async ({ page }) => {
  await openApp(page, 'knowledge-retrieval-logs');
  await page.evaluate(() => {
    const original = window.fetch;
    let fail = true;
    window.fetch = (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      if (path === '/api/knowledge/retrieval-logs' && fail) {
        fail = false;
        return Promise.resolve(new Response(JSON.stringify({ error: 'Temporary outage' }), { status: 503 }));
      }
      return original(input, init);
    };
  });
  await page.locator('#page-knowledge-retrieval-logs .page-header button').click();
  await expect(page.locator('#retrieval-logs-list [role="alert"]')).toContainText('retry');
  await page.locator('#retrieval-logs-list').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.retrieval-log-card')).toHaveCount(2);
});
