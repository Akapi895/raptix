import { expect, openApp, test } from './fixtures';

type AgentWrite = { path: string; method: string; body: unknown };
type Recording = typeof globalThis & { agentWrites: AgentWrite[] };

test('Agents opens from the sidebar and stays active in the collapsed sidebar', async ({ page }) => {
  await openApp(page);
  const agents = page.locator('#main-sidebar .nav-item[data-page="agents"]');
  await expect(agents).toHaveText('Agents');
  await expect(page.locator('#main-sidebar [data-page="roles"], #main-sidebar [data-page="specialist-management"]')).toHaveCount(0);
  await agents.locator('.nav-item-content').click();
  await expect(page).toHaveURL(/#agents$/);
  await expect(agents).toHaveClass(/active/);
  await expect(page.locator('#page-agents h2')).toHaveText('Agents');
  await expect(page.locator('#specialists-list .agent-card-specialist').first()).toBeVisible();
  await page.locator('[data-router-action="sidebar"]').click();
  await agents.locator('.nav-item-content').click();
  await expect(agents).toHaveClass(/active/);
  await expect(page.locator('.submenu-popup')).toHaveCount(0);
});

test('old agent bookmarks redirect to the canonical #agents page', async ({ page }) => {
  await page.goto('/?mock-reset=1#agents-management');
  await expect(page).toHaveURL(/#agents$/);
  await expect(page.locator('#page-agents')).toBeVisible();
  await expect(page.locator('#page-agents-management')).toHaveCount(0);
  await page.goto('/?mock-reset=1#specialist-management?scope=project&tab=tools&specialist=recon');
  await expect(page).toHaveURL(/#agents$/);
});

test('a bare #roles-management bookmark lands on the Specialists tab of #agents with the real registry', async ({ page }) => {
  await page.goto('/?mock-reset=1#roles-management');
  await expect(page).toHaveURL(/#agents$/);
  await expect(page.locator('#specialists-list .agent-card-specialist')).toHaveCount(3);
  await expect(page.locator('#specialists-list')).toContainText('Recon');
});

test('specialist cards open the configuration modal without navigating', async ({ page }) => {
  await openApp(page, 'agents');
  const grid = page.locator('#specialists-list');
  await grid.getByRole('button', { name: /Recon/ }).click();
  const modal = page.locator('#specialist-modal');
  await expect(modal).toBeVisible();
  await expect(page).toHaveURL(/#agents$/);
  await expect(modal.locator('#specialist-modal-title')).toHaveText('Recon');
  await expect(modal.locator('#specialist-modal-description')).toContainText('reconnaissance');
  for (const tab of ['Overview', 'Skills', 'Tools', 'MCP']) {
    await modal.getByRole('tab', { name: tab, exact: true }).click();
    await expect(modal.locator('[data-specialist-content]')).toBeVisible();
  }
  await modal.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(modal.locator('[data-specialist-content]')).toContainText('Effective configuration');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/#agents$/);
});

test('agent CRUD preserves tool assignments, enabled state, and roles API contracts', async ({ page }) => {
  await openApp(page, 'agents');
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  // Demo requests resolve inside fetch, so observe that boundary rather than network events.
  await page.evaluate(() => {
    const target = globalThis as Recording;
    target.agentWrites = [];
    const fetch = target.fetch;
    target.fetch = (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (path.startsWith('/api/roles') && method !== 'GET') target.agentWrites.push({
        path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null,
      });
      return fetch(input, init);
    };
  });
  const writes = () => page.evaluate(() => (globalThis as Recording).agentWrites);
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.locator('#role-modal')).toBeVisible();
  await expect(page.locator('#role-modal-title')).toHaveText('Add agent');
  await page.getByLabel('Agent name', { exact: false }).fill('Recon crew');
  await page.getByLabel('Agent description', { exact: true }).fill('Ships with the recon tools');
  await page.locator('.role-tool-item[data-tool-name="http_probe"] input').check();
  await page.locator('[data-action="roles.save"]').click();
  await expect(page.locator('#role-modal')).toBeHidden();
  expect(await writes()).toMatchObject([{ method: 'POST', path: '/api/roles', body: { name: 'Recon crew', tools: ['http_probe'], enabled: true } }]);
  const card = page.locator('#roles-list .agent-card-persona').filter({ hasText: 'Recon crew' });
  await expect(card).toContainText('http_probe');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#role-modal-title')).toHaveText('Edit agent');
  await expect(page.locator('.role-tool-item[data-tool-name="http_probe"] input')).toBeChecked();
  await page.getByText('Enable this agent', { exact: true }).click();
  await expect(page.getByLabel('Enable this agent')).not.toBeChecked();
  await page.locator('[data-action="roles.save"]').click();
  await expect(card.locator('.agent-card-badge')).toHaveText('Disabled');
  expect((await writes())[1]).toMatchObject({ method: 'PUT', path: '/api/roles/Recon%20crew', body: { name: 'Recon crew', tools: ['http_probe'], enabled: false } });
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('no matching agent');
  await expect(page.locator('#roles-list')).toContainText('No matching agents');
  await page.locator('#roles-search-clear').click();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Delete agent "Recon crew"?'); void dialog.accept(); });
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await writes())[2]).toEqual({ method: 'DELETE', path: '/api/roles/Recon%20crew', body: null });
  expect(await writes()).toHaveLength(3);
});

test('searching custom agents surfaces the filtered empty state', async ({ page }) => {
  await openApp(page, 'agents');
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('zzz-no-such-agent');
  await expect(page.locator('#roles-list')).toContainText('No matching agents');
  await expect(page.locator('#roles-list')).toContainText('Adjust the search or availability filter.');
  await page.locator('#roles-search-clear').click();
  await expect(page.locator('#roles-list .agent-card-persona').first()).toBeVisible();
});

test('keyboard specialist entry keeps focus visible and restores the originating card', async ({ page }) => {
  await openApp(page, 'agents');
  const card = page.locator('#specialists-list [data-specialist-id="recon"]');
  await card.focus();
  await page.keyboard.press('Enter');
  const modal = page.locator('#specialist-modal');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await expect(modal.locator('[data-specialist-scope]')).not.toBeFocused();
  const scope = modal.locator('[data-specialist-scope-toggle]');
  await expect(scope).toHaveAccessibleName(/Configure.*(Global defaults|Current project)/);
  await scope.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(scope).toBeFocused();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeFocused();
});

test('persona creation opens during a stalled catalog, validates fields, and persists instructions', async ({ page }) => {
  await openApp(page, 'agents');
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (input, init) => String(input).includes('/api/config/tools')
      ? new Promise<Response>(() => {}) : fetch(input, init);
  });
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const modal = page.locator('#role-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('not runtime specialists');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal.locator('#role-form-error')).toHaveText('Agent name is required');
  await expect(modal.locator('#role-name')).toBeFocused();
  await modal.locator('#role-name').fill('Catalog independent persona');
  await modal.locator('#role-user-prompt').fill('Review findings with concise evidence references.');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#roles-list')).toContainText('Catalog independent persona');
  await page.reload();
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  const card = page.locator('#roles-list .agent-card-persona').filter({ hasText: 'Catalog independent persona' });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal.locator('#role-user-prompt')).toHaveValue('Review findings with concise evidence references.');
});

test('an unavailable catalog preserves saved tool links and unsaved persona edits require confirmation', async ({ page }) => {
  await openApp(page, 'agents');
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (input, init) => String(input).includes('/api/config/tools')
      ? Promise.resolve(Response.json({ error: 'Runtime catalog unavailable' }, { status: 503 })) : fetch(input, init);
  });
  const card = page.locator('#roles-list .agent-card-persona').filter({ hasText: 'Recon Analyst' });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const modal = page.locator('#role-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.tools-error')).toContainText('existing tool links will be kept');
  await modal.locator('#role-description').fill('Changed while the runtime is unavailable');
  page.once('dialog', dialog => dialog.dismiss());
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(card).toContainText('Changed while the runtime is unavailable');
});
