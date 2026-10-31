import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.text().includes('[csai-mock] unhandled')) errors.push(message.text());
    });
    await use();
    expect(errors, 'Browser errors / missing Go API mock routes').toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function openApp(page: import('@playwright/test').Page, route = 'dashboard'): Promise<void> {
  await page.goto(`/?mock-reset=1#${route}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#csai-mock-badge')).toBeVisible();
  await expect(page.locator('#login-overlay')).toBeHidden();
  const aliases: Record<string, string> = { tasks: 'workflows', 'c2-tasks': 'c2-activity', 'c2-events': 'c2-activity', 'c2-profiles': 'c2-listeners' };
  const requested = route.split('?')[0]!; const routePage = aliases[requested] || requested;
  await expect(page.locator(`#page-${routePage}.active`)).toBeVisible();
}
