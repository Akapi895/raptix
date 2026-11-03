import { expect, openApp, test } from './fixtures';

test('typing @ suggests tools, and Enter inserts the chosen one instead of sending', async ({ page }) => {
  await openApp(page, 'chat');
  const input = page.locator('#chat-input');
  await input.fill('scan with @nm');

  const suggestions = page.locator('#mention-suggestions .mention-item');
  await expect(suggestions.first()).toBeVisible({ timeout: 10_000 });
  await expect(suggestions.first()).toContainText('nmap_scan');

  await input.press('Enter');

  await expect(input).toHaveValue('scan with @nmap_scan ');
  await expect(page.locator('#chat-messages .message.user')).toHaveCount(0);
  await expect(page.locator('#mention-suggestions')).toBeHidden();
});

test('an unsent draft is restored after the page reloads', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('#chat-input').fill('keep this draft');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('raptix-chat-draft'))).toBe('keep this draft');

  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#chat-input')).toHaveValue('keep this draft');
});
