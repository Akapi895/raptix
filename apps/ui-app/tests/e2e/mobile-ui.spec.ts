import { expect, openApp, test } from './fixtures';

test('narrow viewports build the mobile tab bar and drawer head', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'chat');
  await expect(page.locator('#m-tabbar')).toBeVisible();
  await expect(page.locator('#main-sidebar .m-drawer-head')).toHaveCount(1);
});

test('desktop viewports do not build the mobile chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, 'chat');
  await expect(page.locator('#m-tabbar')).toHaveCount(0);
});
