import { expect, openApp, test } from './fixtures';

test('webshell: adding a connection through the modal saves it and lists it', async ({ page }) => {
  await openApp(page, 'webshell');
  await page.locator('button', { hasText: /Add connection/ }).first().click();
  await expect(page.locator('#webshell-modal')).toBeVisible();
  await page.locator('#webshell-url').fill('https://lab.example.test/shell.php');
  await page.locator('#webshell-password').fill('demo-secret');
  await page.locator('#webshell-modal button', { hasText: /Save/ }).click();
  await expect(page.locator('#webshell-modal')).toBeHidden();
  await expect(page.locator('#webshell-list')).toContainText('lab.example.test');
});

test('c2: the create-listener modal opens from the listeners page and closes without saving', async ({ page }) => {
  await openApp(page, 'c2-listeners');
  await page.locator('#page-c2-listeners button', { hasText: /Create listener|\+/ }).first().click();
  await expect(page.locator('#c2-modal')).toBeVisible();
  await page.locator('#c2-modal').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('#c2-modal')).toBeHidden();
});
