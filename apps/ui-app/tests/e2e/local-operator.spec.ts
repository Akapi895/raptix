import { expect, openApp, test } from './fixtures';

test('retired platform management links redirect without requesting account administration data', async ({ page }) => {
  const managementCalls: string[] = [];
  page.on('request', request => {
    if (/\/api\/rbac\/(metadata|users|roles|resource-assignments|resources)(?:[/?]|$)/.test(request.url())) managementCalls.push(request.url());
  });
  for (const hash of ['platform-rbac', '/platform-rbac?user=old', 'settings?section=rbac']) {
    await page.goto('/?mock-reset=1#' + hash);
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await expect(page).toHaveURL(/#dashboard$/);
    await expect(page.locator('#page-dashboard.active')).toBeVisible();
  }
  await expect(page.locator('#page-platform-rbac, #rbac-user-modal, #rbac-role-modal')).toHaveCount(0);
  await expect(page.locator('#main-sidebar [data-page="platform-rbac"]')).toHaveCount(0);
  await expect(page.locator('[data-i18n="navGroups.administration"]')).toHaveCount(0);
  await expect(page.locator('#main-sidebar [data-page="settings"]')).toBeVisible();
  await page.locator('#main-sidebar [data-page="roles-management"] .nav-item-content').click();
  await expect(page).toHaveURL(/#roles-management$/);
  await expect(page.locator('.role-card').first()).toBeVisible();
  expect(managementCalls).toEqual([]);
});

test('single-operator UI keeps sign-out and credential validation', async ({ page }) => {
  await openApp(page);
  await page.locator('#user-avatar-btn').click();
  await page.locator('[data-action="auth.logout"]').click();
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.locator('#login-username').fill('does-not-exist');
  await page.locator('#login-password').fill('invalid-password');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-overlay')).toBeVisible();
  await expect(page.locator('#login-error')).toBeVisible();
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-overlay')).toBeHidden();
});
