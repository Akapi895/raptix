import { expect, test } from '@playwright/test';

test('API docs lists endpoints, filters by group and toggles the auth panel', async ({ page }) => {
  await page.goto('/api-docs');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  const cards = page.locator('#api-docs-main .api-endpoint');
  await expect(cards.first()).toBeVisible();
  const all = await cards.count();
  expect(all).toBeGreaterThan(0);

  const groups = page.locator('#api-group-list .api-group-link');
  expect(await groups.count()).toBeGreaterThan(1);
  await groups.nth(1).click();
  await expect(groups.nth(1)).toHaveClass(/active/);
  await expect.poll(() => cards.count()).toBeLessThanOrEqual(all);
  await groups.first().focus();
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(all);
  await expect(groups.first()).toHaveAttribute('aria-current', 'true');

  const body = page.locator('#auth-info-body');
  const before = await body.evaluate(el => getComputedStyle(el).display);
  await page.locator('.auth-info-header').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => body.evaluate(el => getComputedStyle(el).display)).not.toBe(before);
  await expect(page.locator('.auth-info-header')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('.auth-info-header')).toHaveAttribute('aria-expanded', 'false');
});

test('API docs exposes endpoint headings, labeled test inputs and description state', async ({ page }) => {
  await page.route('**/api/openapi/spec', route => route.fulfill({ json: {
    paths: {
      '/example/{id}': { post: {
        tags: ['Example'], description: '# Details\n\nExisting endpoint documentation.',
        parameters: [{ name: 'id', in: 'path', required: true }, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } } } } } },
      } },
    },
  } }));
  await page.goto('http://127.0.0.1:4174/api-docs');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: /POST.*example/ })).toBeVisible();
  await expect(page.getByLabel('id', { exact: false }).filter({ visible: true }).first()).toBeVisible();
  const inputs = page.locator('.api-test-input-group input, .api-test-input-group textarea');
  expect(await inputs.count()).toBe(3);
  expect(await inputs.evaluateAll(nodes => nodes.every(node => (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && !!node.labels?.length))).toBe(true);
  const toggle = page.locator('.description-toggle-btn');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { level: 4, name: 'Details' })).toBeVisible();
  await expect(toggle).toHaveCSS('outline-style', 'solid');
});

test('API docs loads its responsive stylesheet without missing assets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const missing: string[] = [];
  page.on('response', response => { if (response.status() === 404) missing.push(response.url()); });
  await page.goto('/api-docs');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('.api-docs-content')).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/);
  expect(missing).toEqual([]);
});
