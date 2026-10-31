import { expect, openApp, test } from './fixtures';

test('one-click update renders the installation, source and remote sections from the update API', async ({ page }) => {
  await openApp(page, 'settings');
  // Users reach this section through the settings navigation, which is what loads the console.
  await page.locator('.settings-nav-item, .settings-sidebar button, .settings-nav button').filter({ hasText: /One-Click Update/ }).first().click();
  const console = page.locator('#update-console');
  await expect(console.locator('.update-section')).not.toHaveCount(0);
  await expect(console.locator('.update-section-title').first()).toBeVisible();
});
