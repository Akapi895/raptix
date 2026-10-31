import { expect, openApp, test } from './fixtures';

test('wechat robot: the bind button starts a bind attempt through the TS view', async ({ page }) => {
  await openApp(page, 'settings');
  await page.locator('[data-section="robots"]').click();
  await page.locator('[data-robot-card="wechat"]').click();
  const bind = page.locator('#robot-wechat-bind-btn');
  await expect(bind).toHaveAttribute('data-wechat-action', 'bind');
  await bind.click();
  // The demo transport answers in-page, so wait for the status line the view writes.
  await expect(page.locator('#robot-wechat-qr-status')).not.toHaveText('');
});
