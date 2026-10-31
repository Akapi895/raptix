import { test, expect, openApp } from './fixtures';

test('theme delegates nested clicks, follows system, persists and translates labels', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle-btn')).toHaveAttribute('data-action', 'theme.cycle');
  await expect(page.locator('#theme-toggle-btn')).not.toHaveAttribute('onclick');
  await page.locator('#theme-toggle-btn svg:visible').click();
  await expect(root).toHaveAttribute('data-theme-preference', 'light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#theme-toggle-btn').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('#theme-toggle-label')).toHaveText('Dark');
  await page.locator('#theme-toggle-btn').click();
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
});

test('API docs uses delegated theme and language controls', async ({ page }) => {
  await page.goto('/api-docs');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#theme-toggle-btn')).not.toHaveAttribute('onclick');
  await page.locator('#theme-toggle-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('#theme-toggle-label')).toHaveText('Light');
});
