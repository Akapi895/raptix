import { test, expect, openApp } from './fixtures';

async function readProjectId(page: import('@playwright/test').Page): Promise<string> {
  const href = await page.locator('#project-assets-link').getAttribute('href');
  return new URLSearchParams(href!.split('?')[1]).get('project_id') ?? '';
}

test('the active project is a URL path segment that survives hash navigation and reload', async ({ page }) => {
  await openApp(page, 'projects');
  const projectId = await readProjectId(page);
  expect(projectId).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/${projectId}/#operation-center$`));

  // A same-document hash-only navigation (sidebar, etc.) must keep the project segment.
  await page.evaluate(() => { location.hash = 'dashboard'; });
  await expect(page).toHaveURL(new RegExp(`/${projectId}/#dashboard$`));

  // A hard reload on a project-prefixed URL must still load the app (nginx/vite SPA fallback).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#page-dashboard.active')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${projectId}/#dashboard$`));
});
