import { expect, openApp, test } from './fixtures';

type AgentWrite = { path: string; method: string; body: unknown };
type Recording = typeof globalThis & { agentWrites: AgentWrite[] };

test('Agents opens configuration directly and stays active in the collapsed sidebar', async ({ page }) => {
  await openApp(page);
  const agents = page.locator('#main-sidebar .nav-item[data-page="roles-management"]');
  await expect(agents).toHaveText('Agents');
  await expect(page.locator('#main-sidebar [data-page="roles"], #main-sidebar [data-page="agents"]')).toHaveCount(0);
  await agents.locator('.nav-item-content').click();
  await expect(page).toHaveURL(/#roles-management$/);
  await expect(agents).toHaveClass(/active/);
  await expect(page.locator('#page-roles-management h2')).toHaveText('Agents');
  await expect(page.locator('#roles-list .role-card').first()).toBeVisible();
  await page.locator('[data-router-action="sidebar"]').click();
  await agents.locator('.nav-item-content').click();
  await expect(agents).toHaveClass(/active/);
  await expect(page.locator('.submenu-popup')).toHaveCount(0);
});

test('old agent bookmarks redirect to configuration without the redundant page', async ({ page }) => {
  await page.goto('/?mock-reset=1#agents-management');
  await expect(page).toHaveURL(/#roles-management$/);
  await expect(page.locator('#page-roles-management')).toBeVisible();
  await expect(page.locator('#page-agents-management')).toHaveCount(0);
});

test('agent CRUD preserves tool assignments, enabled state, and roles API contracts', async ({ page }) => {
  await openApp(page, 'roles-management');
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
  await page.getByRole('button', { name: 'Create agent' }).click();
  await expect(page.locator('#role-modal')).toBeVisible();
  await expect(page.locator('#role-modal-title')).toHaveText('Add agent');
  await page.getByLabel('Agent name', { exact: false }).fill('Recon crew');
  await page.getByLabel('Agent description', { exact: true }).fill('Ships with the recon tools');
  await page.locator('.role-tool-item[data-tool-name="http_probe"] input').check();
  await page.locator('[data-action="roles.save"]').click();
  await expect(page.locator('#role-modal')).toBeHidden();
  expect(await writes()).toMatchObject([{ method: 'POST', path: '/api/roles', body: { name: 'Recon crew', tools: ['http_probe'], enabled: true } }]);
  const card = page.locator('#roles-list .role-card').filter({ hasText: 'Recon crew' });
  await expect(card).toContainText('http_probe');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#role-modal-title')).toHaveText('Edit agent');
  await expect(page.locator('.role-tool-item[data-tool-name="http_probe"] input')).toBeChecked();
  await page.getByText('Enable this agent', { exact: true }).click();
  await expect(page.getByLabel('Enable this agent')).not.toBeChecked();
  await page.locator('[data-action="roles.save"]').click();
  await expect(card.locator('.role-card-badge')).toHaveText('Disabled');
  expect((await writes())[1]).toMatchObject({ method: 'PUT', path: '/api/roles/Recon%20crew', body: { name: 'Recon crew', tools: ['http_probe'], enabled: false } });
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('no matching agent');
  await expect(page.locator('#roles-list')).toHaveText('No matching agents');
  await page.locator('#roles-search-clear').click();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Delete agent "Recon crew"?'); void dialog.accept(); });
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await writes())[2]).toEqual({ method: 'DELETE', path: '/api/roles/Recon%20crew', body: null });
  expect(await writes()).toHaveLength(3);
});
