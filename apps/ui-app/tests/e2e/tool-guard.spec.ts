import { expect, openApp, test } from './fixtures';

test('tool guard: an invalid rule is not added and the editor points at the empty field', async ({ page }) => {
  await openApp(page, 'tool-guard');
  await page.locator('#tool-guard-add').click();
  await page.locator('#tool-guard-rule-draft-name').fill('Missing pattern');
  await page.locator('#tool-guard-add-confirm').click();

  await expect(page.locator('#tool-guard-rule-draft-pattern')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#tool-guard-add-dialog')).toBeVisible();
  await expect(page.locator('.tool-guard-rule')).toHaveCount(0);
});
