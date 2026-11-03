import { test, expect, openApp } from './fixtures';

test('chat streams a complete answer', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('#chat-input').fill('Hello migration');
  await page.locator('#chat-send-btn').click();
  await expect(page.locator('#chat-messages .message.user').last()).toContainText('Hello migration');
  await expect(page.locator('#chat-messages .message.assistant').last()).toContainText(/mock|demo/i, { timeout: 25_000 });
  await expect(page.locator('#chat-send-btn')).not.toHaveClass(/is-stop/);
  await expect(page).toHaveURL(/#chat\?conversation=/);
});

test('workspace tabs and collapse', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');
  const panel = page.locator('#csai-ws-panel');
  await expect(panel).toBeVisible();
  for (const tab of ['agents', 'progress']) {
    await page.locator(`#csai-ws-panel-tab-${tab}`).click();
    await expect(page.locator(`#csai-ws-panel-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('[role="tabpanel"]')).not.toBeEmpty();
  }
  await expect(page.locator('#csai-ws-panel-tab-artifacts')).toHaveCount(0);
  await expect(panel.locator('.csai-wsp-files-link')).toHaveAttribute('href', /#chat-files/);
  await panel.locator('.csai-wsp-toggle').click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await panel.locator('.csai-wsp-toggle').click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
});

test('language switcher stays English-only and the choice persists', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('.lang-switcher-btn').click();
  await expect(page.locator('.lang-option[data-lang="en-US"]')).toBeVisible();
  await expect(page.locator('.lang-option[data-lang="zh-CN"]')).toHaveCount(0);
  await page.locator('.lang-option[data-lang="en-US"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('#chat-send-btn')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
});

test('logout, rejected login, and login again', async ({ page }) => {
  await openApp(page);
  await page.locator('#user-avatar-btn').click();
  await page.locator('#user-menu-dropdown [data-action="auth.logout"] ').click();
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.locator('#login-username').fill('does-not-exist');
  await page.locator('#login-password').fill('demo-password');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-error')).toBeVisible();
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-overlay')).toBeHidden();
});

test('create a project through the existing form', async ({ page }) => {
  await openApp(page, 'projects');
  await page.locator('#page-projects [data-action="projects.showNewProjectModal"]').first().click();
  await expect(page.locator('#project-modal')).toBeVisible();
  await page.locator('#project-modal-name').fill('TS parity');
  await page.locator('#project-modal-description').fill('Created by the browser migration test');
  await page.locator('#project-modal-submit-btn').click();
  await expect(page.locator('#project-modal')).toBeHidden();
  await expect(page.locator('#page-projects')).toContainText('TS parity');
});
